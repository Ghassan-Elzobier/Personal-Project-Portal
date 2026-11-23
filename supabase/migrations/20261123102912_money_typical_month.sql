-- Money, part 10: a typical month for fixed costs Money can't find as bills.
--
-- Rent paid to a person at changing amounts, or energy with refunds between payments,
-- never become bills (recurring.ts wants steady gaps and amounts), so a bills category
-- with no budget counted nowhere. The budget's numbers now give each category its net
-- total (money out less money back in) for each of the 6 full months before
-- p_month_start, oldest first, so the app can count such a category at its typical
-- month (fixedMonthly in src/lib/money/budget.ts). And the owner can set a category's
-- monthly budget from the Money page, to confirm or change that figure.
--
-- Expand only: a new key in the budget's categories, and a new RPC beside the old ones.

-- As before (part 9), plus months: [6 net totals, oldest first] for each category.
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
                         from generate_series(1, 8) k),
               'months', (select jsonb_agg(coalesce((
                            select -sum(t.pence) from portal.bank_transactions t
                            where t.category_id = c.id
                              and t.made_on >= (p_month_start - make_interval(months => k))::date
                              and t.made_on < (p_month_start - make_interval(months => k - 1))::date), 0) order by k desc)
                          from generate_series(1, 6) k))
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

-- The owner sets one category's monthly budget (null clears it, 0 counts nothing).
create function public.money_set_category_budget(p_key text, p_pence bigint)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  if p_pence is not null and (p_pence < 0 or p_pence > 10000000) then
    raise exception 'A monthly budget is between 0 and 100000 pounds.' using errcode = '22023';
  end if;
  update portal.money_categories set budget_pence = p_pence where key = p_key;
  if not found then
    raise exception 'There is no category ''%''.', p_key using errcode = '22023';
  end if;
end;
$function$;

-- The owner's browser session only.
revoke all on function public.money_set_category_budget(text, bigint) from public, anon;
grant execute on function public.money_set_category_budget(text, bigint) to authenticated, service_role;
