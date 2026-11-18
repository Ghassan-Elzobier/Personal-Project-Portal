-- Money, part 7: pay in pounds, for the forecast.
--
--   money_income  take-home on each payday from a day on, until a later step (half
--                 pay in December, full pay from January); the gross salary it came
--                 from can sit beside it
--
-- The budget read gains the steps and the latest pay (the newest payment sorted as
-- Pay), so the forecast puts pay on each payday and a real payslip replaces the
-- estimate. The engine sorts a pay by itself: an unsorted payment in, within 3 days of
-- a payday, of at least half the pay expected, becomes Pay, with a rule so the next
-- ones do too. Claude can set the steps at the plan level.

create table portal.money_income (
  id               bigint generated always as identity primary key,
  from_on          date not null unique,
  pence            bigint not null check (pence between 0 and 10000000),
  gross_year_pence bigint check (gross_year_pence is null or gross_year_pence between 0 and 100000000),
  added_by         text not null default 'owner' check (added_by in ('owner', 'claude')),
  created_at       timestamptz not null default now()
);
alter table portal.money_income enable row level security;
revoke all on table portal.money_income from public, anon, authenticated;

-- Adds a pay step, or changes the one starting that day. {from_on, pence, gross_year_pence?}
create function portal.money_put_income(p jsonb, p_by text)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_id bigint;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->>'from_on' is null or p->>'pence' is null then
    raise exception 'A pay step needs the day it starts and the take-home.' using errcode = '22023';
  end if;
  insert into portal.money_income (from_on, pence, gross_year_pence, added_by)
  values ((p->>'from_on')::date, (p->>'pence')::bigint, nullif(p->>'gross_year_pence', '')::bigint, p_by)
  on conflict (from_on) do update
  set pence = excluded.pence, gross_year_pence = excluded.gross_year_pence, added_by = excluded.added_by
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function portal.money_put_income(jsonb, text) from public, anon, authenticated;

create function public.money_save_income(p jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  return portal.money_put_income(p, 'owner');
end;
$function$;

create function public.money_remove_income(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  delete from portal.money_income where id = p_id;
end;
$function$;

-- Claude at the plan level sets the owner's high-level plan; for now, the pay steps.
-- {income?: [{from_on, pence, gross_year_pence?}], remove_income?: ['YYYY-MM-DD']}
create function public.money_claude_set_plan(p jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v jsonb;
  v_saved integer := 0;
  v_removed integer := 0;
begin
  perform portal.require_money_claude(p_access_hash, 'plan');
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Send the plan as an object.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p->'income', '[]')) > 24 or jsonb_array_length(coalesce(p->'remove_income', '[]')) > 24 then
    raise exception 'Send up to 24 pay steps at a time.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(coalesce(p->'income', '[]')) loop
    perform portal.money_put_income(v, 'claude');
    v_saved := v_saved + 1;
  end loop;
  with gone as (
    delete from portal.money_income
    where from_on in (select (d #>> '{}')::date from jsonb_array_elements(coalesce(p->'remove_income', '[]')) d)
    returning 1
  )
  select count(*) into v_removed from gone;
  return jsonb_build_object('income_saved', v_saved, 'income_removed', v_removed);
end;
$function$;

-- ---------------------------------------------------------------------------
-- The engine sorts a pay by itself
-- ---------------------------------------------------------------------------

-- As before, plus what spotting a pay needs: the payday settings, the pay steps, and
-- unsorted money in from the last 10 days.
create or replace function public.money_engine_read(p_since date, p_sync_key text default null)
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
    'bills', coalesce((select jsonb_agg(portal.money_bill_json(b, true) order by b.id) from portal.money_bills b), '[]'),
    'settings', (select jsonb_build_object('payday_rule', payday_rule, 'first_payday', first_payday)
                 from portal.money_settings where id),
    'income', coalesce((select jsonb_agg(jsonb_build_object('from_on', from_on, 'pence', pence) order by from_on)
                        from portal.money_income), '[]'),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'made_on', t.made_on, 'pence', t.pence) order by t.made_on, t.id)
      from portal.bank_transactions t
      where t.status = 'booked' and t.pence > 0 and t.category_id is null and t.made_on >= current_date - 10), '[]')
  );
end;
$function$;

-- Sorts an unsorted payment in as Pay, with a rule for its merchant (after the owner's
-- own rules, before the starter set) so the next pay is sorted too.
create function public.money_mark_pay(p_txn bigint, p_sync_key text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_pay bigint;
  v_merchant text;
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  select id into v_pay from portal.money_categories where key = 'pay';
  if v_pay is null then
    raise exception 'There is no Pay category.';
  end if;
  select merchant_key into v_merchant from portal.bank_transactions
  where id = p_txn and pence > 0 and category_id is null;
  if not found then
    raise exception 'That payment is not unsorted money in.' using errcode = '22023';
  end if;
  if length(v_merchant) >= 2 and not exists (
    select 1 from portal.money_rules where field = 'merchant' and pattern = v_merchant
  ) then
    insert into portal.money_rules (field, pattern, category_id, position, min_pence)
    values ('merchant', v_merchant, v_pay, 999, 1);
  end if;
  update portal.bank_transactions set category_id = v_pay, category_by = 'rule' where id = p_txn;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The budget read gains pay
-- ---------------------------------------------------------------------------

-- As before, plus the pay steps and the latest pay (the newest payment sorted as Pay).
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
      from portal.money_bills b), '[]'),
    'income', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'from_on', i.from_on, 'pence', i.pence,
               'gross_year_pence', i.gross_year_pence, 'added_by', i.added_by) order by i.from_on)
      from portal.money_income i), '[]'),
    'last_pay', (
      select jsonb_build_object('on', t.made_on, 'pence', t.pence)
      from portal.bank_transactions t join portal.money_categories c on c.id = t.category_id
      where c.key = 'pay' and t.pence > 0 and t.status = 'booked'
      order by t.made_on desc, t.id desc limit 1)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Who may call what: this part's functions, and part 6's (bills), which shipped
-- without this block. Each still checks the caller inside; this is the outer door.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  -- The owner's browser session only.
  foreach f in array array['money_set_bill(bigint, text, text)', 'money_save_income(jsonb)',
                           'money_remove_income(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- The scheduled sync (no session; it proves itself with its key) and Claude's RPCs
  -- (connector calls prove themselves with p_access_hash).
  foreach f in array array['money_engine_read(date, text)', 'money_adopt_bills(jsonb, text)',
                           'money_raise_alerts(jsonb, text)', 'money_mark_pay(bigint, text)',
                           'money_claude_bills(jsonb, text)', 'money_claude_set_plan(jsonb, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
