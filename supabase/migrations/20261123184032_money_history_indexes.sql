-- Money: the budget stays quick as bank history grows.
--
-- Payments are never pruned, so every read of the budget (Today, Gym, Kitchen, Jobs and
-- Money all make one) must not read the whole history:
--
--   bank_transactions_category_day_idx  one category (or the unsorted ones) between two
--                                        days: each week and month sum in money_budget_data
--   bank_transactions_merchant_day_idx  money out to one merchant, newest first: a bill's
--                                        latest payment in money_bill_json
--
-- money_bill_matches has a SET clause, so Postgres never inlines it and the planner
-- can't see its merchant test. money_bill_json now states that test itself beside the
-- call; the call still decides, so every result stays the same.
--
-- Expand only: two indexes, and one function redefined with the same result.

create index bank_transactions_category_day_idx on portal.bank_transactions (category_id, made_on);
create index bank_transactions_merchant_day_idx on portal.bank_transactions (merchant_key, made_on desc, id desc)
  where pence < 0;

-- As 20261123102605_money_subscriptions.sql left it, with the latest payment looked up
-- through the merchant index.
create or replace function portal.money_bill_json(b portal.money_bills, p_named boolean)
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
    'last_paid_on', l.made_on, 'last_pence', -l.pence,
    'reviewed_on', case when p_named then b.reviewed_on end, 'verdict', case when p_named then b.verdict end)
  from (select null) x
  left join lateral (select t.made_on, t.pence from portal.bank_transactions t
                     where t.merchant_key = b.merchant_key and t.pence < 0
                       and portal.money_bill_matches(b, t)
                     order by t.made_on desc, t.id desc limit 1) l on true;
$function$;
revoke all on function portal.money_bill_json(portal.money_bills, boolean) from public, anon, authenticated;
