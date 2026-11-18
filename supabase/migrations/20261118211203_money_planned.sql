-- Money, part 5: planned purchases, for "can I afford it?".
--
--   money_planned  a one-off cost you've planned ("bike repair, about £60, this week"),
--                  and how it's paid for: from this week's amount, spread over a few
--                  weeks, or from what's safe to spend before payday
--
-- The budget counts each one before the card is used, so a plan never surprises the
-- weekly amount. When the payment arrives (within 25% of the amount and 14 days of the
-- day planned) it is linked and the plan becomes paid, so it is never counted twice.
-- The owner adds them on the Money page; Claude adds them at the plan level, and can
-- change or cancel only the ones it added. "Can I afford it?" is worked out in the app
-- from the budget read (src/lib/money/budget.ts): it writes nothing.

create table portal.money_planned (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 60),
  pence       bigint not null check (pence between 1 and 10000000),
  due_on      date not null,
  category_id bigint references portal.money_categories (id) on delete set null,
  funding     text not null check (funding in ('allowance', 'spread', 'safe')),
  weeks       smallint not null default 1 check (weeks between 1 and 12),
  status      text not null default 'planned' check (status in ('planned', 'paid', 'cancelled')),
  txn_id      bigint references portal.bank_transactions (id) on delete set null,
  added_by    text not null check (added_by in ('owner', 'claude')),
  created_at  timestamptz not null default now()
);
alter table portal.money_planned enable row level security;
revoke all on table portal.money_planned from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- After new payments arrive: watched merchants, and planned purchases now paid
-- ---------------------------------------------------------------------------

create or replace function portal.money_watch(p_since_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v record;
  v_txn bigint;
begin
  insert into portal.money_alerts (kind, dedupe, subject_id, detail)
  select distinct on (t.id) 'watched', 'watched:' || t.id, t.id, jsonb_build_object('rule', r.id)
  from portal.bank_transactions t
  join portal.money_rules r on r.watch and portal.money_rule_matches(r, t)
  where t.id >= p_since_id and t.status = 'booked' and t.made_on >= current_date - 7
  order by t.id, r.position, r.id
  on conflict (dedupe) do nothing;

  -- Each planned purchase takes the closest new payment that fits it, nearest amount first.
  for v in select * from portal.money_planned where status = 'planned' order by due_on, id loop
    select t.id into v_txn
    from portal.bank_transactions t
    where t.id >= p_since_id and t.status = 'booked' and t.pence < 0
      and abs(-t.pence - v.pence) <= v.pence * 0.25
      and t.made_on between v.due_on - 14 and v.due_on + 14
      and not exists (select 1 from portal.money_planned p where p.txn_id = t.id)
    order by abs(-t.pence - v.pence), abs(t.made_on - v.due_on), t.id
    limit 1;
    if v_txn is not null then
      update portal.money_planned set status = 'paid', txn_id = v_txn where id = v.id;
    end if;
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Reading: the budget now includes what's planned
-- ---------------------------------------------------------------------------

create or replace function public.money_budget(p_month_start date, p_week_start date, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_last date := p_week_start - 7;
begin
  perform portal.require_money_claude(p_access_hash, 'summary');
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
                                       where t.category_id = c.id and t.pence < 0 and t.made_on >= p_week_start), 0),
               'spent_last_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                            where t.category_id = c.id and t.pence < 0
                                              and t.made_on >= v_last and t.made_on < p_week_start), 0))
             order by c.position, c.id)
      from portal.money_categories c), '[]'),
    'unsorted_week', coalesce((select -sum(pence) from portal.bank_transactions
                               where category_id is null and pence < 0 and made_on >= p_week_start), 0),
    'unsorted_last_week', coalesce((select -sum(pence) from portal.bank_transactions
                                    where category_id is null and pence < 0
                                      and made_on >= v_last and made_on < p_week_start), 0),
    'planned', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'pence', p.pence, 'due_on', p.due_on,
               'funding', p.funding, 'weeks', p.weeks, 'added_by', p.added_by,
               'category', (select key from portal.money_categories where id = p.category_id))
             order by p.due_on, p.id)
      from portal.money_planned p where p.status = 'planned'), '[]')
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Saving and cancelling: the owner, and Claude at the plan level
-- ---------------------------------------------------------------------------

-- Adds a planned purchase, or with an id changes one; Claude only ever touches its own.
-- {id?, name, pence, due_on, funding, weeks?, category?}
create function portal.money_put_planned(p jsonb, p_by text)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_id bigint;
  v_cat bigint;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Send the purchase as an object.' using errcode = '22023';
  end if;
  if p->>'category' is not null then
    select id into v_cat from portal.money_categories where key = p->>'category';
  end if;
  if p ? 'id' then
    update portal.money_planned
    set name = coalesce(p->>'name', name),
        pence = coalesce((p->>'pence')::bigint, pence),
        due_on = coalesce((p->>'due_on')::date, due_on),
        funding = coalesce(p->>'funding', funding),
        weeks = coalesce((p->>'weeks')::smallint, weeks),
        category_id = coalesce(v_cat, category_id)
    where id = (p->>'id')::bigint and status = 'planned' and (p_by = 'owner' or added_by = 'claude')
    returning id into v_id;
    if v_id is null then
      raise exception 'There is no planned purchase % that can be changed.', p->>'id';
    end if;
    return v_id;
  end if;
  insert into portal.money_planned (name, pence, due_on, category_id, funding, weeks, added_by)
  values (p->>'name', (p->>'pence')::bigint, (p->>'due_on')::date, v_cat, p->>'funding',
          coalesce((p->>'weeks')::smallint, 1), p_by)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function portal.money_put_planned(jsonb, text) from public, anon, authenticated;

create function public.money_save_planned(p jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  return portal.money_put_planned(p, 'owner');
end;
$function$;

create function public.money_cancel_planned(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  update portal.money_planned set status = 'cancelled' where id = p_id and status = 'planned';
end;
$function$;

-- Claude, once the owner has picked how to pay for something in the chat: saves it,
-- or changes or cancels ({id, cancel: true}) one Claude added. Nothing else.
create function public.money_claude_plan_purchase(p jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_id bigint;
begin
  perform portal.require_money_claude(p_access_hash, 'plan');
  if (p->>'cancel')::boolean then
    update portal.money_planned set status = 'cancelled'
    where id = (p->>'id')::bigint and status = 'planned' and added_by = 'claude'
    returning id into v_id;
    if v_id is null then
      raise exception 'There is no planned purchase % that Claude added and can cancel.', p->>'id';
    end if;
    return jsonb_build_object('cancelled', v_id);
  end if;
  v_id := portal.money_put_planned(p - 'cancel', 'claude');
  return jsonb_build_object('saved', v_id);
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array['money_save_planned(jsonb)', 'money_cancel_planned(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.money_claude_plan_purchase(jsonb, text) from public';
  execute 'grant execute on function public.money_claude_plan_purchase(jsonb, text) to anon, authenticated, service_role';
end;
$$;
