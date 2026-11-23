-- Money: put the goals in a new order in one go. The Money page uses it to put the
-- debts highest-interest first or smallest-balance first with one tap; moving one
-- goal a step at a time (money_move_goal) stays as it is. Owner only.

-- p_ids: every goal not done, first first.
create function public.money_order_goals(p_ids bigint[])
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_money_owner();
  if p_ids is null or cardinality(p_ids) > 200
     or cardinality(p_ids) <> (select count(distinct i) from unnest(p_ids) i)
     or (select array_agg(id order by id) from portal.money_goals where status <> 'done')
        is distinct from (select array_agg(i order by i) from unnest(p_ids) i) then
    raise exception 'Send every goal not done, once each.' using errcode = '22023';
  end if;
  update portal.money_goals g set position = o.n, updated_at = now()
  from unnest(p_ids) with ordinality o (id, n)
  where g.id = o.id;
end;
$function$;

revoke all on function public.money_order_goals(bigint[]) from public, anon;
grant execute on function public.money_order_goals(bigint[]) to authenticated, service_role;
