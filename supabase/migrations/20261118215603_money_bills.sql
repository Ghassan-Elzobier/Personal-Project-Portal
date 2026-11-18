-- Money, part 6: bills Money finds by itself.
--
--   money_bills  a regular payment (rent, energy, a subscription): who it goes to, how
--                often (weekly, monthly or yearly), a day it falls on, what it usually
--                costs, and whether the owner ignored it or it has ended
--
-- Bills are found after each sync by src/lib/money/recurring.ts, from the payments
-- already held, and adopted here through money_adopt_bills with the sync's key (or the
-- owner's session on Refresh). A bill the owner ignores is never adopted again. Safe-to-
-- spend then uses each bill's real day instead of a monthly estimate, and a payment to
-- a bill no longer counts against the weekly amount.
--
-- A bill is told apart from others at the same merchant by its amount (band_pence),
-- when one merchant takes several regular payments (an app store's subscriptions).
-- Bills come from bank data, so erasing the bank data erases them too.

create table portal.money_bills (
  id             bigint generated always as identity primary key,
  ident          text not null unique check (ident ~ '^[a-z0-9-]{1,60}(~[0-9]{1,8})?$'),
  merchant_key   text not null check (merchant_key ~ '^[a-z0-9-]{1,60}$'),
  band_pence     bigint check (band_pence is null or band_pence > 0),
  name           text not null check (length(trim(name)) between 1 and 60),
  name_by        text not null default 'engine' check (name_by in ('engine', 'owner', 'claude')),
  cadence        text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  anchor_on      date not null,
  expected_pence bigint not null check (expected_pence between 1 and 10000000),
  variable       boolean not null default false,
  category_id    bigint references portal.money_categories (id) on delete set null,
  status         text not null default 'active' check (status in ('active', 'ignored', 'ended')),
  added_by       text not null default 'engine' check (added_by in ('engine', 'owner', 'claude')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table portal.money_bills enable row level security;
revoke all on table portal.money_bills from public, anon, authenticated;

-- Whether a payment is one of a bill's: money out to its merchant, and within 15% of
-- its amount when the bill is told apart by amount.
create function portal.money_bill_matches(b portal.money_bills, t portal.bank_transactions)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select t.pence < 0 and t.merchant_key = b.merchant_key
     and (b.band_pence is null or abs(-t.pence - b.band_pence) * 100 <= b.band_pence * 15);
$function$;
revoke all on function portal.money_bill_matches(portal.money_bills, portal.bank_transactions) from public, anon, authenticated;

-- Whether a payment belongs to an active bill (so it isn't this week's spending).
create function portal.money_is_bill_payment(t portal.bank_transactions)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (select 1 from portal.money_bills b where b.status = 'active' and portal.money_bill_matches(b, t));
$function$;
revoke all on function portal.money_is_bill_payment(portal.bank_transactions) from public, anon, authenticated;

-- A bill as the app reads it, with its latest payment. Who it goes to (its name and
-- merchant) only for the owner and the engine: Claude at summary sees totals by category.
create function portal.money_bill_json(b portal.money_bills, p_named boolean)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', b.id, 'ident', case when p_named then b.ident end, 'merchant_key', case when p_named then b.merchant_key end,
    'band_pence', b.band_pence, 'name', case when p_named then b.name end, 'cadence', b.cadence,
    'anchor_on', b.anchor_on, 'expected_pence', b.expected_pence, 'variable', b.variable,
    'category', (select key from portal.money_categories where id = b.category_id),
    'status', b.status, 'added_by', b.added_by, 'created_at', b.created_at,
    'last_paid_on', l.made_on, 'last_pence', -l.pence)
  from (select null) x
  left join lateral (select t.made_on, t.pence from portal.bank_transactions t
                     where portal.money_bill_matches(b, t)
                     order by t.made_on desc, t.id desc limit 1) l on true;
$function$;
revoke all on function portal.money_bill_json(portal.money_bills, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The engine: reading payments, adopting bills, raising alerts
-- ---------------------------------------------------------------------------

-- What finding bills needs: booked money out since p_since to a merchant, unsorted or
-- sorted as a bill, and every bill as it stands. The sync's key or the owner.
create function public.money_engine_read(p_since date, p_sync_key text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  return jsonb_build_object(
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('made_on', t.made_on, 'pence', -t.pence, 'merchant_key', t.merchant_key,
               'name', left(coalesce(t.counterparty, t.description), 60), 'category_id', t.category_id)
             order by t.made_on, t.id)
      from portal.bank_transactions t
      left join portal.money_categories c on c.id = t.category_id
      where t.status = 'booked' and t.pence < 0 and t.merchant_key is not null and t.made_on >= p_since
        and (t.category_id is null or c.kind = 'bills')), '[]'),
    'bills', coalesce((select jsonb_agg(portal.money_bill_json(b, true) order by b.id) from portal.money_bills b), '[]')
  );
end;
$function$;

-- Adopts the bills found, by ident: a new one is added; one already there is brought up
-- to date (its name only if nobody renamed it, its category only if it has none); an
-- ignored one is left alone. {ident, merchant_key, band_pence?, name, cadence,
-- anchor_on, expected_pence, variable, category_id?, status?: 'active' | 'ended'}.
-- Returns how many are new.
create function public.money_adopt_bills(p_bills jsonb, p_sync_key text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v jsonb;
  v_new integer := 0;
  v_inserted boolean;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  if jsonb_typeof(p_bills) is distinct from 'array' or jsonb_array_length(p_bills) > 200 then
    raise exception 'Send up to 200 bills as a list.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(p_bills) loop
    if coalesce(v->>'status', 'active') not in ('active', 'ended') then
      raise exception 'A bill found is active or ended.' using errcode = '22023';
    end if;
    insert into portal.money_bills (ident, merchant_key, band_pence, name, cadence, anchor_on, expected_pence, variable,
                                    category_id, status)
    values (v->>'ident', v->>'merchant_key', nullif(v->>'band_pence', '')::bigint, left(v->>'name', 60), v->>'cadence',
            (v->>'anchor_on')::date, (v->>'expected_pence')::bigint, coalesce((v->>'variable')::boolean, false),
            (select id from portal.money_categories where id = nullif(v->>'category_id', '')::bigint),
            coalesce(v->>'status', 'active'))
    on conflict (ident) do update
    set cadence = excluded.cadence,
        anchor_on = excluded.anchor_on,
        expected_pence = excluded.expected_pence,
        variable = excluded.variable,
        band_pence = excluded.band_pence,
        name = case when portal.money_bills.name_by = 'engine' then excluded.name else portal.money_bills.name end,
        category_id = coalesce(portal.money_bills.category_id, excluded.category_id),
        status = excluded.status,
        updated_at = now()
    where portal.money_bills.status <> 'ignored'
    returning (xmax = 0) into v_inserted;
    if coalesce(v_inserted, false) then
      v_new := v_new + 1;
    end if;
  end loop;
  return v_new;
end;
$function$;

-- Raises the alerts the engine found about bills, once each (by dedupe).
-- {kind: 'price-rise' | 'missed-bill', dedupe, ident, detail}.
create function public.money_raise_alerts(p_alerts jsonb, p_sync_key text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_added integer;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  if jsonb_typeof(p_alerts) is distinct from 'array' or jsonb_array_length(p_alerts) > 200 then
    raise exception 'Send up to 200 alerts as a list.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_alerts) a
             where a->>'kind' is null or a->>'kind' not in ('price-rise', 'missed-bill')) then
    raise exception 'The engine raises only bill alerts.' using errcode = '22023';
  end if;
  with added as (
    insert into portal.money_alerts (kind, dedupe, subject_id, detail)
    select a->>'kind', a->>'dedupe', b.id, coalesce(a->'detail', '{}'::jsonb)
    from jsonb_array_elements(p_alerts) a
    join portal.money_bills b on b.ident = a->>'ident' and b.status = 'active'
    on conflict (dedupe) do nothing
    returning 1
  )
  select count(*) into v_added from added;
  return v_added;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The owner, and Claude at setup
-- ---------------------------------------------------------------------------

-- Ignores a bill (it is never adopted again) or takes it back, and can rename it.
create function public.money_set_bill(p_id bigint, p_status text default null, p_name text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  if p_status is not null and p_status not in ('active', 'ignored') then
    raise exception 'A bill is active or ignored.' using errcode = '22023';
  end if;
  update portal.money_bills
  set status = coalesce(p_status, status),
      name = coalesce(nullif(trim(p_name), ''), name),
      name_by = case when nullif(trim(p_name), '') is null then name_by else 'owner' end,
      updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'There is no bill %.', p_id;
  end if;
end;
$function$;

-- Claude at setup: name a bill, sort it into a category, ignore it or take it back.
-- [{id, name?, category?, status?: 'active' | 'ignored'}]. Returns how many changed.
create function public.money_claude_bills(p_changes jsonb, p_access_hash text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v jsonb;
  v_n integer := 0;
begin
  perform portal.require_money_claude(p_access_hash, 'setup');
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) > 100 then
    raise exception 'Send up to 100 bill changes as a list.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(p_changes) loop
    if v->>'status' is not null and v->>'status' not in ('active', 'ignored') then
      raise exception 'A bill is active or ignored.' using errcode = '22023';
    end if;
    if v->>'category' is not null and not exists (select 1 from portal.money_categories where key = v->>'category') then
      raise exception 'There is no category %.', v->>'category';
    end if;
    update portal.money_bills
    set name = coalesce(nullif(trim(v->>'name'), ''), name),
        name_by = case when nullif(trim(v->>'name'), '') is null then name_by else 'claude' end,
        category_id = coalesce((select id from portal.money_categories where key = v->>'category'), category_id),
        status = coalesce(v->>'status', status),
        updated_at = now()
    where id = (v->>'id')::bigint;
    if not found then
      raise exception 'There is no bill %.', v->>'id';
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The budget now knows the bills
-- ---------------------------------------------------------------------------

-- As before, plus every bill with its latest payment (named for the owner, and for
-- Claude only at setup), and a payment to an active bill no longer counts as this
-- week's spending.
create or replace function public.money_budget(p_month_start date, p_week_start date, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_last date := p_week_start - 7;
  v_named boolean;
begin
  perform portal.require_money_claude(p_access_hash, 'summary');
  v_named := p_access_hash is null
             or exists (select 1 from portal.money_settings where id and claude_access = 'setup');
  return jsonb_build_object(
    'balance_pence', (
      select sum(b.pence) from portal.bank_accounts a
      join portal.bank_connections c on c.id = a.connection_id and c.status <> 'off'
      join lateral (select pence from portal.bank_balances where account_id = a.id order by at desc limit 1) b on true
      where a.in_safe and not a.hidden),
    'settings', (select jsonb_build_object('allowance_pence', allowance_pence, 'buffer_pence', buffer_pence,
                   'buffer_from', buffer_from, 'payday_rule', payday_rule, 'first_payday', first_payday)
                 from portal.money_settings where id),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'name', c.name, 'kind', c.kind, 'budget_pence', c.budget_pence,
               'paid_month', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                       where t.category_id = c.id and t.pence < 0 and t.made_on >= p_month_start), 0),
               'spent_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                       where t.category_id = c.id and t.pence < 0 and t.made_on >= p_week_start
                                         and not portal.money_is_bill_payment(t)), 0),
               'spent_last_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                            where t.category_id = c.id and t.pence < 0
                                              and t.made_on >= v_last and t.made_on < p_week_start
                                              and not portal.money_is_bill_payment(t)), 0))
             order by c.position, c.id)
      from portal.money_categories c), '[]'),
    'unsorted_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                               where t.category_id is null and t.pence < 0 and t.made_on >= p_week_start
                                 and not portal.money_is_bill_payment(t)), 0),
    'unsorted_last_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                    where t.category_id is null and t.pence < 0
                                      and t.made_on >= v_last and t.made_on < p_week_start
                                      and not portal.money_is_bill_payment(t)), 0),
    'planned', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'pence', p.pence, 'due_on', p.due_on,
               'funding', p.funding, 'weeks', p.weeks, 'added_by', p.added_by,
               'category', (select key from portal.money_categories where id = p.category_id))
             order by p.due_on, p.id)
      from portal.money_planned p where p.status = 'planned'), '[]'),
    'bills', coalesce((
      select jsonb_agg(portal.money_bill_json(b, v_named) order by b.anchor_on, b.id)
      from portal.money_bills b), '[]')
  );
end;
$function$;

-- As before, and the bills go too: they come from the bank data.
create or replace function public.money_forget_all()
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  delete from portal.money_alerts where true;
  delete from portal.money_bills where true;
  delete from portal.bank_connections where true;
end;
$function$;
