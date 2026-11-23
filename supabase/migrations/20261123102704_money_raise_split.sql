-- Money, part 10: where a pay rise goes. When a later pay step is higher than the pay
-- now, the owner chooses once what share of the extra goes to goals; the rest raises the
-- weekly amount. The choice stands for every later rise, measured against the pay step
-- on the day it was made.
--
--   money_settings  gains raise_goal_share_bp (null: not asked yet; 0 to 10000) and
--                   raise_since, the day the extra is measured from.
--
-- Both are saved through the settings the owner already saves (money_save_settings), and
-- the budget read returns them. Additive: the old code ignores them.

alter table portal.money_settings
  add column raise_goal_share_bp integer check (raise_goal_share_bp is null or raise_goal_share_bp between 0 and 10000),
  add column raise_since date;

-- As before (part 8), plus the share of a rise for goals and the day it is measured from.
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
      raise_goal_share_bp = case when p ? 'raise_goal_share_bp' then (p->>'raise_goal_share_bp')::integer
                                 else raise_goal_share_bp end,
      raise_since = case when p ? 'raise_since' then (p->>'raise_since')::date else raise_since end,
      -- A changed plan is worked out afresh for this week.
      week_amount_of = case when p ? 'weekly_floor_pence' or p ? 'allowance_pence' or p ? 'raise_goal_share_bp'
                            then null else week_amount_of end,
      updated_at = now()
  where id;
end;
$function$;

-- As before (part 9), plus raise_goal_share_bp and raise_since in the settings.
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
                   'last_week', last_week, 'raise_goal_share_bp', raise_goal_share_bp,
                   'raise_since', raise_since)
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
