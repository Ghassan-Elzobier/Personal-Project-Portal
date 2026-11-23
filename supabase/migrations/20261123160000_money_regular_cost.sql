-- Money, part 11: a regular cost as a goal (issue #173).
--
-- A goal of kind 'recurring' is an ongoing cost the owner wants to take on (a weekly
-- session, a gym upgrade): what it costs and how often, an optional setup fee, an
-- optional bill it replaces, an optional start day (empty: start when it fits), the
-- session weekday for a weekly cost, and whether the price is a guess. The app turns it
-- into a made-up bill inside the budget data (src/lib/money/ongoing.ts), so the
-- forecast, the payday share-out, safe-to-spend and the autopilot all count it.
--
-- Once it has started, the payments that look like it (to the merchant the owner gave,
-- or within 15% of its cost) come with the goal, so the app knows it has been paid; and
-- when the engine adopts the real bill, it stores the bill's id on the goal so the
-- made-up bill stops counting.
--
-- Expand only: new nullable columns and wider checks; the functions keep their
-- signatures and read and write the old fields as before.

alter table portal.money_goals
  add column cost_pence bigint check (cost_pence is null or cost_pence between 1 and 10000000),
  add column cadence text check (cadence is null or cadence in ('weekly', 'monthly', 'yearly')),
  add column setup_pence bigint check (setup_pence is null or setup_pence between 0 and 10000000),
  add column replaces_merchant_key text
    check (replaces_merchant_key is null or replaces_merchant_key ~ '^[a-z0-9-]{1,60}$'),
  add column replace_overlap boolean not null default false,
  add column start_on date,
  add column weekday smallint check (weekday is null or weekday between 0 and 6),
  add column estimated boolean not null default false,
  add column bill_id bigint references portal.money_bills (id) on delete set null;

alter table portal.money_goals drop constraint money_goals_kind_check;
alter table portal.money_goals add constraint money_goals_kind_check
  check (kind in ('saving', 'sinking', 'debt', 'recurring'));
alter table portal.money_goals drop constraint money_goals_check;
alter table portal.money_goals add constraint money_goals_check
  check (kind in ('debt', 'recurring') or target_pence is not null);
alter table portal.money_goals add constraint money_goals_recurring_check
  check (kind <> 'recurring' or (cost_pence is not null and cadence is not null));

-- As part 8 left it, plus a regular cost's fields, and once it has started (and its
-- bill isn't adopted yet), the payments since a week before its start that look like it:
-- to its merchant when one is given, else within 15% of its cost. Merchants (its own,
-- the one it replaces, each payment's) only for the owner; others see each payment's
-- merchant as a number, so payments to one merchant still go together.
create or replace function portal.money_goal_json(g portal.money_goals, p_named boolean)
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
                               and t.made_on >= g.saved_on), 0))
  || case when g.kind <> 'recurring' then '{}'::jsonb else jsonb_build_object(
    'cost_pence', g.cost_pence, 'cadence', g.cadence, 'setup_pence', g.setup_pence,
    'replaces_merchant_key', case when p_named then g.replaces_merchant_key end,
    'replace_overlap', g.replace_overlap, 'start_on', g.start_on, 'weekday', g.weekday,
    'estimated', g.estimated, 'bill_id', g.bill_id,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('on', m.made_on, 'pence', m.pence, 'merchant', m.merchant) order by m.made_on)
      from (
        select t.made_on, -t.pence as pence,
               case when p_named then t.merchant_key
                    else (dense_rank() over (order by t.merchant_key))::text end as merchant
        from portal.bank_transactions t
        where g.start_on is not null and g.bill_id is null and t.pence < 0
          and t.made_on >= g.start_on - 7
          and case when g.merchant_key is not null then t.merchant_key = g.merchant_key
                   else abs(-t.pence - g.cost_pence) <= g.cost_pence * 0.15 end
        order by t.made_on desc
        limit 40) m), '[]'))
  end;
$function$;
revoke all on function portal.money_goal_json(portal.money_goals, boolean) from public, anon, authenticated;

-- As part 9 left it, plus a regular cost's fields. Its adopted bill is the engine's to set.
create or replace function portal.money_put_goal(p jsonb, p_by text)
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
        cost_pence = case when p ? 'cost_pence' then (p->>'cost_pence')::bigint else cost_pence end,
        cadence = case when p ? 'cadence' then p->>'cadence' else cadence end,
        setup_pence = case when p ? 'setup_pence' then (p->>'setup_pence')::bigint else setup_pence end,
        replaces_merchant_key = case when p ? 'replaces_merchant_key' then nullif(p->>'replaces_merchant_key', '')
                                     else replaces_merchant_key end,
        replace_overlap = coalesce((p->>'replace_overlap')::boolean, replace_overlap),
        start_on = case when p ? 'start_on' then (p->>'start_on')::date else start_on end,
        weekday = case when p ? 'weekday' then (p->>'weekday')::smallint else weekday end,
        estimated = coalesce((p->>'estimated')::boolean, estimated),
        updated_at = now()
    where id = (p->>'id')::bigint
    returning id into v_id;
    if v_id is null then
      raise exception 'There is no goal %.', p->>'id';
    end if;
    return v_id;
  end if;
  insert into portal.money_goals (name, kind, target_pence, due_on, repeats_yearly, held, saved_pence, saved_on,
                                  apr_bp, payment_pence, merchant_key, category_id, position, added_by,
                                  cost_pence, cadence, setup_pence, replaces_merchant_key, replace_overlap,
                                  start_on, weekday, estimated)
  values (p->>'name', p->>'kind', (p->>'target_pence')::bigint, (p->>'due_on')::date,
          coalesce((p->>'repeats_yearly')::boolean, false), coalesce(p->>'held', 'account'),
          coalesce((p->>'saved_pence')::bigint, 0),
          -- Only the owner dates a saved figure in the past: a date from Claude would reach
          -- back over payments it may not read.
          coalesce(case when p_by = 'owner' then (p->>'saved_on')::date end, current_date),
          (p->>'apr_bp')::integer, (p->>'payment_pence')::bigint, nullif(p->>'merchant_key', ''), v_cat,
          coalesce((select max(position) from portal.money_goals), 0) + 1, p_by,
          (p->>'cost_pence')::bigint, p->>'cadence', (p->>'setup_pence')::bigint,
          nullif(p->>'replaces_merchant_key', ''), coalesce((p->>'replace_overlap')::boolean, false),
          (p->>'start_on')::date, (p->>'weekday')::smallint, coalesce((p->>'estimated')::boolean, false))
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function portal.money_put_goal(jsonb, text) from public, anon, authenticated;

-- As part 9 left it, and the bill a regular cost replaces is a merchant too: from
-- Claude, linking one needs setup, like the goal's own merchant.
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

  v_setup := exists (select 1 from portal.money_settings where id and claude_access = 'setup');
  for v in select * from jsonb_array_elements(coalesce(p->'goals', '[]')) loop
    perform portal.money_put_goal(case when v_setup then v else v - 'merchant_key' - 'replaces_merchant_key' end,
                                  'claude');
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

-- As part 9 left it, plus goal_bills: [{goal, bill}], the real bill the engine adopted
-- for a regular cost. Set once, on an active regular cost without one.
create or replace function public.money_engine_apply(p jsonb, p_sync_key text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_job(p_sync_key, 'bank-sync');
  if jsonb_typeof(p) is distinct from 'object' or jsonb_array_length(coalesce(p->'set_aside', '[]')) > 30
     or jsonb_array_length(coalesce(p->'goal_bills', '[]')) > 30 then
    raise exception 'Send what the engine decided as an object.' using errcode = '22023';
  end if;
  update portal.money_settings
  set week_amount_pence = case when p ? 'week_amount' then (p->'week_amount'->>'pence')::bigint else week_amount_pence end,
      week_amount_of = case when p ? 'week_amount' then (p->'week_amount'->>'of')::date else week_amount_of end,
      last_week_closed = coalesce((p->>'closed_week')::date, last_week_closed),
      last_payday_done = coalesce((p->>'payday_done')::date, last_payday_done),
      payday_transfers = case when jsonb_typeof(p->'payday_transfers') = 'object' then p->'payday_transfers'
                              else payday_transfers end,
      last_week = case when jsonb_typeof(p->'last_week') = 'object' then p->'last_week' else last_week end,
      updated_at = now()
  where id;
  update portal.money_goals g
  set saved_pence = least(100000000, g.saved_pence + greatest(0, (a->>'pence')::bigint)), updated_at = now()
  from jsonb_array_elements(coalesce(p->'set_aside', '[]')) a
  where g.id = (a->>'goal')::bigint and g.held = 'account' and g.kind not in ('debt', 'recurring')
    and g.status = 'active';
  update portal.money_goals g
  set bill_id = b.id, updated_at = now()
  from jsonb_array_elements(coalesce(p->'goal_bills', '[]')) a
  join portal.money_bills b on b.id = (a->>'bill')::bigint and b.status = 'active'
  where g.id = (a->>'goal')::bigint and g.kind = 'recurring' and g.status = 'active' and g.bill_id is null;
end;
$function$;
