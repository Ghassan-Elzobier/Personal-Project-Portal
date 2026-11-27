-- Life: a shop lands in the kitchen in one step.
--
-- Confirming a delivery or a fresh week's shop (and undoing one) used to call
-- life_stock once or twice and then life_save_plan, each its own transaction. A
-- failure between them left the food in the kitchen while the shop still showed
-- as not done, and tapping again added it twice. life_land_shop makes the stock
-- changes and the plan save together, and refuses a shop that is already in (or
-- an undo of one that is not), so a retry is always safe.
--
-- life_stock keeps its signature and behaviour: its body moves into
-- portal.life_stock_apply, which both functions call. The code before this
-- migration runs on as it did.

-- Stock changes: [{item, qty?, status?, good_until?}]. 'add' adds qty (a
-- delivery), 'set' replaces it (a stock check). Status and date replace when given.
create function portal.life_stock_apply(p_changes jsonb, p_mode text)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v jsonb;
  v_qty numeric;
begin
  if p_mode is null or p_mode not in ('add', 'set') then
    raise exception 'Mode is add or set.' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    v_qty := nullif(v->>'qty', '')::numeric;
    insert into portal.kitchen_stock (item, qty, status, good_until)
    values (v->>'item', greatest(0, coalesce(v_qty, 0)), v->>'status', nullif(v->>'good_until', '')::date)
    on conflict (item) do update
      set qty = case
                  when v_qty is null then portal.kitchen_stock.qty
                  when p_mode = 'add' then greatest(0, portal.kitchen_stock.qty + v_qty)
                  else greatest(0, v_qty)
                end,
          status = case when v ? 'status' then v->>'status' else portal.kitchen_stock.status end,
          good_until = case when v ? 'good_until' then nullif(v->>'good_until', '')::date else portal.kitchen_stock.good_until end,
          updated_at = now();
  end loop;
end;
$function$;
revoke all on function portal.life_stock_apply(jsonb, text) from public, anon, authenticated;

create or replace function public.life_stock(p_changes jsonb, p_mode text, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  perform portal.life_stock_apply(p_changes, p_mode);
end;
$function$;

-- Lands a shop (or takes one back out): p_steps is [{mode, changes}], applied in
-- order, then p_plan is saved as the week starting p_start, all or nothing.
-- p_trip names a fresh week's shop in the plan's trips; null is the batch week's
-- one shop (the plan's shop). Landing is when p_plan has the shop done (shop
-- deliveredOn, or the trip's doneOn) and undoing is when it has it not done; the
-- stored plan must say the opposite, so a repeated call is refused, not doubled.
create function public.life_land_shop(
  p_start date,
  p_steps jsonb,
  p_plan jsonb,
  p_trip text default null,
  p_access_hash text default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_stored jsonb;
  v_was jsonb;
  v_will jsonb;
  v_step jsonb;
begin
  perform portal.require_life_owner(p_access_hash);
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception 'The stock changes are a list.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object' then
    raise exception 'The week''s plan is missing.' using errcode = '22023';
  end if;

  select data into v_stored from portal.meal_plans where start = p_start for update;
  if v_stored is null then
    raise exception 'Plan the week first.' using errcode = 'P0002';
  end if;

  if p_trip is null then
    v_was := v_stored->'shop'->'deliveredOn';
    v_will := p_plan->'shop'->'deliveredOn';
  else
    if not exists (select 1 from jsonb_array_elements(coalesce(v_stored->'trips', '[]'::jsonb)) t where t->>'id' = p_trip) then
      raise exception 'That shop is not in this week''s plan.' using errcode = 'P0002';
    end if;
    select t->'doneOn' into v_was from jsonb_array_elements(v_stored->'trips') t where t->>'id' = p_trip limit 1;
    select t->'doneOn' into v_will from jsonb_array_elements(coalesce(p_plan->'trips', '[]'::jsonb)) t where t->>'id' = p_trip limit 1;
  end if;
  v_was := nullif(v_was, 'null'::jsonb);
  v_will := nullif(v_will, 'null'::jsonb);

  if v_will is not null and v_was is not null then
    raise exception '%', case when p_trip is null then 'This week''s delivery is already in.' else 'That shop is done already.' end
      using errcode = '22023';
  end if;
  if v_will is null and v_was is null then
    raise exception '%', case when p_trip is null then 'No delivery to undo.' else 'No shop to undo.' end
      using errcode = '22023';
  end if;

  for v_step in select * from jsonb_array_elements(p_steps) loop
    perform portal.life_stock_apply(v_step->'changes', v_step->>'mode');
  end loop;

  update portal.meal_plans set data = p_plan, updated_at = now() where start = p_start;
end;
$function$;

-- It checks for the owner itself. anon too: connector calls have no session and
-- prove themselves with p_access_hash.
revoke all on function public.life_land_shop(date, jsonb, jsonb, text, text) from public;
grant execute on function public.life_land_shop(date, jsonb, jsonb, text, text) to anon, authenticated, service_role;
