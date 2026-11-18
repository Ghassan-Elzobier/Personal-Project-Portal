-- Money, part 8: the plan runs itself. Goals, a weekly floor, and the engine that sets
-- money aside on payday and closes each week.
--
--   money_goals     what the money is for, in order: saving for something, putting money
--                   by for a yearly or one-off cost (kept in the account, on paper), or a
--                   debt. Each keeps what it held on a day; what's moved to it (transfers
--                   to its saver, payments to its lender) and spent from it (its category)
--                   since then comes from the payments, so nothing is typed twice.
--   money_settings  gains the weekly floor (set, it turns the autopilot on), this week's
--                   amount as the engine fixed it on Monday, and the last week and payday
--                   the engine has dealt with, so it does each once.
--
-- The budget read is moved into portal.money_budget_data, so the engine reads the same
-- numbers with the sync's key as the page and Claude do. The engine writes back through
-- money_engine_apply: this week's amount, last week closed (what was left goes to the
-- first goal kept in the account), and money set aside on payday for goals kept there.
-- It raises an alert when a payday's transfer to a saver hasn't shown up.

alter table portal.money_settings
  add column weekly_floor_pence bigint check (weekly_floor_pence is null or weekly_floor_pence between 0 and 1000000),
  add column week_amount_pence bigint check (week_amount_pence is null or week_amount_pence between 0 and 1000000),
  add column week_amount_of date,
  add column last_week_closed date,
  add column last_payday_done date,
  -- The moves the plan asked for on the last payday ({payday, transfers: [{goal, name, pence}]}),
  -- kept so the check that they arrived measures against what the owner was shown.
  add column payday_transfers jsonb check (payday_transfers is null or (jsonb_typeof(payday_transfers) = 'object'
                                                                        and pg_column_size(payday_transfers) < 8192));

alter table portal.money_alerts drop constraint money_alerts_kind_check;
alter table portal.money_alerts add constraint money_alerts_kind_check
  check (kind in ('watched', 'new-bill', 'price-rise', 'missed-bill', 'low-safe', 'transfer-missing'));

create table portal.money_goals (
  id             bigint generated always as identity primary key,
  name           text not null check (length(trim(name)) between 1 and 60),
  kind           text not null check (kind in ('saving', 'sinking', 'debt')),
  target_pence   bigint check (target_pence is null or target_pence between 0 and 100000000),
  due_on         date,
  repeats_yearly boolean not null default false,
  held           text not null default 'account' check (held in ('account', 'elsewhere')),
  saved_pence    bigint not null default 0 check (saved_pence between 0 and 100000000),
  saved_on       date not null default current_date,
  apr_bp         integer check (apr_bp is null or apr_bp between 0 and 10000),
  payment_pence  bigint check (payment_pence is null or payment_pence between 0 and 10000000),
  merchant_key   text check (merchant_key is null or merchant_key ~ '^[a-z0-9-]{1,60}$'),
  category_id    bigint references portal.money_categories (id) on delete set null,
  position       smallint not null default 0,
  status         text not null default 'active' check (status in ('active', 'done', 'paused')),
  added_by       text not null default 'owner' check (added_by in ('owner', 'claude', 'engine')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (kind = 'debt' or target_pence is not null)
);
alter table portal.money_goals enable row level security;
revoke all on table portal.money_goals from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- A goal as the app reads it: money moved to its merchant since its saved day (out less
-- back) and spent in its category since then. Its merchant only for the owner.
create function portal.money_goal_json(g portal.money_goals, p_named boolean)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'kind', g.kind, 'target_pence', g.target_pence, 'due_on', g.due_on,
    'repeats_yearly', g.repeats_yearly, 'held', g.held, 'saved_pence', g.saved_pence, 'saved_on', g.saved_on,
    'apr_bp', g.apr_bp, 'payment_pence', g.payment_pence,
    'merchant_key', case when p_named then g.merchant_key end,
    'category', (select key from portal.money_categories where id = g.category_id),
    'position', g.position, 'status', g.status, 'added_by', g.added_by,
    'moved_pence', coalesce((select -sum(t.pence) from portal.bank_transactions t
                             where g.merchant_key is not null and t.merchant_key = g.merchant_key
                               and t.made_on >= g.saved_on), 0),
    'spent_pence', coalesce((select -sum(t.pence) from portal.bank_transactions t
                             where g.category_id is not null and t.category_id = g.category_id and t.pence < 0
                               and t.made_on >= g.saved_on), 0));
$function$;
revoke all on function portal.money_goal_json(portal.money_goals, boolean) from public, anon, authenticated;

-- Adds a goal, or changes one by id. Claude may change any goal (it plans with the
-- owner) but never its saved figures; the owner sets those. Returns the id.
-- {id?, name, kind, target_pence?, due_on?, repeats_yearly?, held?, saved_pence?, saved_on?,
--  apr_bp?, payment_pence?, merchant_key?, category?, status?}
create function portal.money_put_goal(p jsonb, p_by text)
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
    raise exception 'Send the goal as an object.' using errcode = '22023';
  end if;
  if p->>'category' is not null then
    select id into v_cat from portal.money_categories where key = p->>'category';
    if v_cat is null then
      raise exception 'There is no category "%".', p->>'category';
    end if;
  end if;
  if p ? 'id' then
    update portal.money_goals
    set name = coalesce(p->>'name', name),
        kind = coalesce(p->>'kind', kind),
        target_pence = case when p ? 'target_pence' then (p->>'target_pence')::bigint else target_pence end,
        due_on = case when p ? 'due_on' then (p->>'due_on')::date else due_on end,
        repeats_yearly = coalesce((p->>'repeats_yearly')::boolean, repeats_yearly),
        held = coalesce(p->>'held', held),
        saved_pence = case when p_by = 'owner' and p ? 'saved_pence' then (p->>'saved_pence')::bigint else saved_pence end,
        saved_on = case when p_by = 'owner' and p ? 'saved_pence' then coalesce((p->>'saved_on')::date, current_date)
                        else saved_on end,
        apr_bp = case when p ? 'apr_bp' then (p->>'apr_bp')::integer else apr_bp end,
        payment_pence = case when p ? 'payment_pence' then (p->>'payment_pence')::bigint else payment_pence end,
        merchant_key = case when p ? 'merchant_key' then nullif(p->>'merchant_key', '') else merchant_key end,
        category_id = case when p ? 'category' then v_cat else category_id end,
        status = coalesce(p->>'status', status),
        updated_at = now()
    where id = (p->>'id')::bigint
    returning id into v_id;
    if v_id is null then
      raise exception 'There is no goal %.', p->>'id';
    end if;
    return v_id;
  end if;
  insert into portal.money_goals (name, kind, target_pence, due_on, repeats_yearly, held, saved_pence, saved_on,
                                  apr_bp, payment_pence, merchant_key, category_id, position, added_by)
  values (p->>'name', p->>'kind', (p->>'target_pence')::bigint, (p->>'due_on')::date,
          coalesce((p->>'repeats_yearly')::boolean, false), coalesce(p->>'held', 'account'),
          coalesce((p->>'saved_pence')::bigint, 0),
          -- Only the owner dates a saved figure in the past: a date from Claude would reach
          -- back over payments it may not read.
          coalesce(case when p_by = 'owner' then (p->>'saved_on')::date end, current_date),
          (p->>'apr_bp')::integer, (p->>'payment_pence')::bigint, nullif(p->>'merchant_key', ''), v_cat,
          coalesce((select max(position) from portal.money_goals), 0) + 1, p_by)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function portal.money_put_goal(jsonb, text) from public, anon, authenticated;

-- As before, plus the weekly floor (null turns the autopilot off).
create or replace function portal.money_apply_settings(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Send the settings as an object.' using errcode = '22023';
  end if;
  if p ? 'claude_access' then
    raise exception 'Claude''s access to Money is set by the owner on the Money page.' using errcode = '42501';
  end if;
  update portal.money_settings
  set buffer_pence = coalesce((p->>'buffer_pence')::bigint, buffer_pence),
      buffer_from = case when p ? 'buffer_from' then (p->>'buffer_from')::date else buffer_from end,
      payday_rule = coalesce(p->>'payday_rule', payday_rule),
      first_payday = case when p ? 'first_payday' then (p->>'first_payday')::date else first_payday end,
      allowance_pence = case when p ? 'allowance_pence' then (p->>'allowance_pence')::bigint else allowance_pence end,
      weekly_floor_pence = case when p ? 'weekly_floor_pence' then (p->>'weekly_floor_pence')::bigint
                                else weekly_floor_pence end,
      -- A changed plan is worked out afresh for this week.
      week_amount_of = case when p ? 'weekly_floor_pence' or p ? 'allowance_pence' then null else week_amount_of end,
      updated_at = now()
  where id;
end;
$function$;

-- The budget's numbers, for whoever has been let in: the owner, Claude at summary, or
-- the engine with the sync's key. Names and merchants only when p_named.
create function portal.money_budget_data(p_month_start date, p_week_start date, p_named boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_last date := p_week_start - 7;
begin
  return jsonb_build_object(
    'balance_pence', (
      select sum(b.pence) from portal.bank_accounts a
      join portal.bank_connections c on c.id = a.connection_id and c.status <> 'off'
      join lateral (select pence from portal.bank_balances where account_id = a.id order by at desc limit 1) b on true
      where a.in_safe and not a.hidden),
    'settings', (select jsonb_build_object('allowance_pence', allowance_pence, 'buffer_pence', buffer_pence,
                   'buffer_from', buffer_from, 'payday_rule', payday_rule, 'first_payday', first_payday,
                   'weekly_floor_pence', weekly_floor_pence, 'week_amount_pence', week_amount_pence,
                   'week_amount_of', week_amount_of, 'last_week_closed', last_week_closed,
                   'last_payday_done', last_payday_done, 'payday_transfers', payday_transfers)
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
      select jsonb_agg(portal.money_bill_json(b, p_named) order by b.anchor_on, b.id)
      from portal.money_bills b), '[]'),
    'income', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'from_on', i.from_on, 'pence', i.pence,
               'gross_year_pence', i.gross_year_pence, 'added_by', i.added_by) order by i.from_on)
      from portal.money_income i), '[]'),
    'last_pay', (
      select jsonb_build_object('on', t.made_on, 'pence', t.pence)
      from portal.bank_transactions t join portal.money_categories c on c.id = t.category_id
      where c.key = 'pay' and t.pence > 0 and t.status = 'booked'
      order by t.made_on desc, t.id desc limit 1),
    'goals', coalesce((
      select jsonb_agg(portal.money_goal_json(g, p_named) order by g.position, g.id)
      from portal.money_goals g where g.status <> 'done'), '[]')
  );
end;
$function$;
revoke all on function portal.money_budget_data(date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The budget read: the owner, or Claude at summary (named at setup)
-- ---------------------------------------------------------------------------

create or replace function public.money_budget(p_month_start date, p_week_start date, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_claude(p_access_hash, 'summary');
  return portal.money_budget_data(p_month_start, p_week_start,
    p_access_hash is null or exists (select 1 from portal.money_settings where id and claude_access = 'setup'));
end;
$function$;

-- ---------------------------------------------------------------------------
-- The owner's goals
-- ---------------------------------------------------------------------------

create function public.money_save_goal(p jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  return portal.money_put_goal(p, 'owner');
end;
$function$;

create function public.money_remove_goal(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  delete from portal.money_goals where id = p_id;
end;
$function$;

-- Moves a goal one place up (-1) or down (1) in the order.
create function public.money_move_goal(p_id bigint, p_step integer)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_ids bigint[];
  v_at integer;
  v_to integer;
begin
  perform portal.require_money_owner();
  select array_agg(id order by position, id) into v_ids from portal.money_goals where status <> 'done';
  v_at := array_position(v_ids, p_id);
  if v_at is null then
    raise exception 'There is no goal %.', p_id;
  end if;
  v_to := v_at + sign(p_step)::integer;
  if v_to < 1 or v_to > array_length(v_ids, 1) then
    return;
  end if;
  v_ids[v_at] := v_ids[v_to];
  v_ids[v_to] := p_id;
  update portal.money_goals g set position = o.n, updated_at = now()
  from unnest(v_ids) with ordinality o (id, n)
  where g.id = o.id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Claude at the plan level sets the high-level plan: pay, goals, the week, the buffer
-- ---------------------------------------------------------------------------

-- {income?, remove_income?, goals?: [goal], remove_goals?: [id], order?: [id],
--  weekly?: {floor_pence, target_pence}, buffer?: {pence, from}}
-- Claude removes only goals it or the engine added.
create or replace function public.money_claude_set_plan(p jsonb, p_access_hash text default null)
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
  v_goals integer := 0;
  v_gone integer := 0;
  v_setup boolean;
begin
  perform portal.require_money_claude(p_access_hash, 'plan');
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Send the plan as an object.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p->'income', '[]')) > 24 or jsonb_array_length(coalesce(p->'remove_income', '[]')) > 24
     or jsonb_array_length(coalesce(p->'goals', '[]')) > 30 then
    raise exception 'Send up to 24 pay steps and 30 goals at a time.' using errcode = '22023';
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

  -- A goal's merchant makes its progress the money paid to that merchant, so linking one
  -- would let Claude read spending at any merchant: that needs setup, like the history.
  v_setup := exists (select 1 from portal.money_settings where id and claude_access = 'setup');
  for v in select * from jsonb_array_elements(coalesce(p->'goals', '[]')) loop
    perform portal.money_put_goal(case when v_setup then v else v - 'merchant_key' end, 'claude');
    v_goals := v_goals + 1;
  end loop;
  with gone as (
    delete from portal.money_goals
    where added_by in ('claude', 'engine')
      and id in (select (d #>> '{}')::bigint from jsonb_array_elements(coalesce(p->'remove_goals', '[]')) d)
    returning 1
  )
  select count(*) into v_gone from gone;
  if jsonb_typeof(p->'order') = 'array' then
    update portal.money_goals g set position = o.n, updated_at = now()
    from jsonb_array_elements_text(p->'order') with ordinality o (id, n)
    where g.id = o.id::bigint;
  end if;

  if p ? 'weekly' or p ? 'buffer' then
    perform portal.money_apply_settings(jsonb_strip_nulls(jsonb_build_object(
      'weekly_floor_pence', p->'weekly'->'floor_pence', 'allowance_pence', p->'weekly'->'target_pence',
      'buffer_pence', p->'buffer'->'pence', 'buffer_from', p->'buffer'->'from')));
  end if;
  return jsonb_build_object('income_saved', v_saved, 'income_removed', v_removed, 'goals_saved', v_goals,
                            'goals_removed', v_gone);
end;
$function$;

-- ---------------------------------------------------------------------------
-- The engine
-- ---------------------------------------------------------------------------

-- The budget's numbers, for the engine with the sync's key (or the owner on Refresh),
-- plus each goal's transfers to its merchant in the last 45 days, to check a payday's
-- transfer arrived.
create function public.money_engine_budget(p_month_start date, p_week_start date, p_sync_key text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  return portal.money_budget_data(p_month_start, p_week_start, true) || jsonb_build_object(
    'goal_moves', coalesce((
      select jsonb_agg(jsonb_build_object('goal', g.id, 'on', t.made_on, 'pence', -t.pence) order by t.made_on)
      from portal.money_goals g
      join portal.bank_transactions t on t.merchant_key = g.merchant_key and t.made_on >= current_date - 45
      where g.status = 'active' and g.merchant_key is not null), '[]'));
end;
$function$;

-- What the engine decided: {week_amount?: {of, pence}, closed_week?: date,
-- payday_done?: date, payday_transfers?: {payday, transfers}, set_aside?: [{goal, pence}]}. Setting aside adds to a goal kept in
-- the account; it never touches one kept elsewhere (that money moves by transfer).
create function public.money_engine_apply(p jsonb, p_sync_key text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  if jsonb_typeof(p) is distinct from 'object' or jsonb_array_length(coalesce(p->'set_aside', '[]')) > 30 then
    raise exception 'Send what the engine decided as an object.' using errcode = '22023';
  end if;
  update portal.money_settings
  set week_amount_pence = case when p ? 'week_amount' then (p->'week_amount'->>'pence')::bigint else week_amount_pence end,
      week_amount_of = case when p ? 'week_amount' then (p->'week_amount'->>'of')::date else week_amount_of end,
      last_week_closed = coalesce((p->>'closed_week')::date, last_week_closed),
      last_payday_done = coalesce((p->>'payday_done')::date, last_payday_done),
      payday_transfers = case when jsonb_typeof(p->'payday_transfers') = 'object' then p->'payday_transfers'
                              else payday_transfers end,
      updated_at = now()
  where id;
  update portal.money_goals g
  set saved_pence = least(100000000, g.saved_pence + greatest(0, (a->>'pence')::bigint)), updated_at = now()
  from jsonb_array_elements(coalesce(p->'set_aside', '[]')) a
  where g.id = (a->>'goal')::bigint and g.held = 'account' and g.kind <> 'debt' and g.status = 'active';
end;
$function$;

-- As before, and a goal's transfer that hasn't shown up: {kind: 'transfer-missing', dedupe, goal, detail}.
create or replace function public.money_raise_alerts(p_alerts jsonb, p_sync_key text default null)
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
             where a->>'kind' is null or a->>'kind' not in ('price-rise', 'missed-bill', 'transfer-missing')) then
    raise exception 'The engine raises only bill and goal alerts.' using errcode = '22023';
  end if;
  with added as (
    insert into portal.money_alerts (kind, dedupe, subject_id, detail)
    select a->>'kind', a->>'dedupe', coalesce(b.id, g.id), coalesce(a->'detail', '{}'::jsonb)
    from jsonb_array_elements(p_alerts) a
    left join portal.money_bills b on a->>'kind' <> 'transfer-missing' and b.ident = a->>'ident' and b.status = 'active'
    left join portal.money_goals g on a->>'kind' = 'transfer-missing' and g.id = (a->>'goal')::bigint
                                  and g.status = 'active'
    where coalesce(b.id, g.id) is not null
    on conflict (dedupe) do nothing
    returning 1
  )
  select count(*) into v_added from added;
  return v_added;
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array['money_save_goal(jsonb)', 'money_remove_goal(bigint)', 'money_move_goal(bigint, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['money_engine_budget(date, date, text)', 'money_engine_apply(jsonb, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
