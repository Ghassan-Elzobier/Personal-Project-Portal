-- Money, part 9: the weekly summary, written with no input.
--
--   money_settings.last_week  what the engine recorded when it closed last week: its
--                             amount, what was spent, and what went to which goal
--
-- The budget's numbers gain each category's spending (and the unsorted) for each of the
-- 8 weeks before this one, so the summary can set last week against the usual week.

alter table portal.money_settings
  add column last_week jsonb check (last_week is null or (jsonb_typeof(last_week) = 'object'
                                                          and pg_column_size(last_week) < 4096));

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
