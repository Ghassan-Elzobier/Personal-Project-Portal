-- Money, part 9: the weekly summary, written with no input; and two fixes to part 8
-- found in review after it merged.
--
--   money_settings.last_week  what the engine recorded when it closed last week: its
--                             amount, what was spent, and what went to which goal
--
-- The budget's numbers gain each category's spending (and the unsorted) for each of the
-- 8 weeks before this one, so the summary can set last week against the usual week.

alter table portal.money_settings
  add column last_week jsonb check (last_week is null or (jsonb_typeof(last_week) = 'object'
                                                          and pg_column_size(last_week) < 4096));

-- ---------------------------------------------------------------------------
-- Fixes to part 8
-- ---------------------------------------------------------------------------

-- 1. The moves the plan asked for on the last payday ({payday, transfers: [{goal, name,
--    pence}]}), kept so the check that they arrived measures against what the owner was
--    shown. Worked out again later, the plan differs: the set-asides and the moves
--    themselves have filled the goals by then, which raised alerts for moves made in full.
alter table portal.money_settings
  add column payday_transfers jsonb check (payday_transfers is null or (jsonb_typeof(payday_transfers) = 'object'
                                                                        and pg_column_size(payday_transfers) < 8192));

-- 2. A goal's merchant makes its progress the money paid to that merchant, so linking one
--    reads spending at any merchant: from Claude, that now needs setup (like the history),
--    and a saved figure from Claude is always dated today, never reaching back.
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


-- As before (part 8), plus each category's and the unsorted spending for the 8 weeks
-- before p_week_start (oldest first, a bill's payments left out), and last_week.
create or replace function portal.money_budget_data(p_month_start date, p_week_start date, p_named boolean)
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
                   'last_payday_done', last_payday_done, 'payday_transfers', payday_transfers,
                   'last_week', last_week)
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
                                              and not portal.money_is_bill_payment(t)), 0),
               'weeks', (select jsonb_agg(coalesce((
                           select -sum(t.pence) from portal.bank_transactions t
                           where t.category_id = c.id and t.pence < 0
                             and t.made_on >= p_week_start - 7 * k and t.made_on < p_week_start - 7 * (k - 1)
                             and not portal.money_is_bill_payment(t)), 0) order by k desc)
                         from generate_series(1, 8) k))
             order by c.position, c.id)
      from portal.money_categories c), '[]'),
    'unsorted_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                               where t.category_id is null and t.pence < 0 and t.made_on >= p_week_start
                                 and not portal.money_is_bill_payment(t)), 0),
    'unsorted_last_week', coalesce((select -sum(t.pence) from portal.bank_transactions t
                                    where t.category_id is null and t.pence < 0
                                      and t.made_on >= v_last and t.made_on < p_week_start
                                      and not portal.money_is_bill_payment(t)), 0),
    'unsorted_weeks', (select jsonb_agg(coalesce((
                         select -sum(t.pence) from portal.bank_transactions t
                         where t.category_id is null and t.pence < 0
                           and t.made_on >= p_week_start - 7 * k and t.made_on < p_week_start - 7 * (k - 1)
                           and not portal.money_is_bill_payment(t)), 0) order by k desc)
                       from generate_series(1, 8) k),
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

-- As before (part 8), plus last_week: {week, amount_pence, spent_pence, swept: [{goal, name, pence}]}.
create or replace function public.money_engine_apply(p jsonb, p_sync_key text default null)
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
      last_week = case when jsonb_typeof(p->'last_week') = 'object' then p->'last_week' else last_week end,
      updated_at = now()
  where id;
  update portal.money_goals g
  set saved_pence = least(100000000, g.saved_pence + greatest(0, (a->>'pence')::bigint)), updated_at = now()
  from jsonb_array_elements(coalesce(p->'set_aside', '[]')) a
  where g.id = (a->>'goal')::bigint and g.held = 'account' and g.kind <> 'debt' and g.status = 'active';
end;
$function$;
