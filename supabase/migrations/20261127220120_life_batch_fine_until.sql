-- "Still fine until": the owner's own call that one fridge batch is fine to eat
-- past its Food Standards Agency eat-by (two days, rice one). Null keeps the rule.
-- The app caps it at two days past the rule's date and shows the FSA advice before
-- saving it; the database keeps it within a week of cooking whatever calls it.
--
-- Expand only: a nullable column, life_read returning one key more (the previous
-- deployment ignores it), and a new function beside the old ones.

alter table portal.meal_batches add column fine_until date;
alter table portal.meal_batches
  add constraint meal_batches_fine_until_check check (fine_until is null or (fine_until > cooked_on and fine_until <= cooked_on + 7));

-- As before, with each batch's fine_until.
create or replace function public.life_read(p_since date, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  return jsonb_build_object(
    'profile', (select data from portal.life_profile where id),
    'weights', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'kg', kg) order by day) from portal.body_weights where day >= p_since - 60), '[]'),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('start', start, 'data', data) order by start) from portal.meal_plans where start >= p_since - 14), '[]'),
    'meals', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'slot', slot, 'status', status, 'recipe', recipe, 'batch_gid', batch_gid::text, 'kcal', kcal, 'protein', protein, 'note', note) order by day, slot) from portal.meal_log where day >= p_since - 28), '[]'),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('gid', gid::text, 'recipe', recipe, 'cooked_on', cooked_on, 'portions', portions, 'remaining', remaining, 'scale', scale, 'location', location, 'plan_start', plan_start, 'cook_id', cook_id, 'fine_until', fine_until) order by cooked_on, gid) from portal.meal_batches where remaining > 0 or cooked_on >= p_since - 14), '[]'),
    'ratings', coalesce((select jsonb_agg(jsonb_build_object('recipe', recipe, 'stars', stars, 'note', note)) from portal.recipe_ratings), '[]'),
    'last_had', coalesce((select jsonb_object_agg(recipe, last) from (select recipe, max(day) as last from portal.meal_log where recipe is not null and status = 'eaten' group by recipe) x), '{}'),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('item', item, 'qty', qty, 'status', status, 'good_until', good_until)) from portal.kitchen_stock), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object('item', item, 'url', url, 'name', name, 'pack_qty', pack_qty, 'pack_unit', pack_unit, 'pence', pence, 'checked', to_jsonb(checked))) from portal.kitchen_products), '[]'),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'workout', workout, 'finished', finished_at is not null, 'feel', feel, 'notes', notes) order by day) from portal.gym_sessions where day >= p_since - 180), '[]'),
    'sets', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'workout', g.workout, 'exercise', s.exercise, 'position', s.position, 'kg', s.kg, 'reps', s.reps, 'rir', s.rir) order by s.day, s.exercise, s.position) from portal.gym_sets s join portal.gym_sessions g using (day) where s.day >= p_since - 180), '[]')
  );
end;
$function$;

-- Sets the day a fridge batch is still fine until, or clears it (p_until null).
create function public.life_set_batch_fine_until(p_batch bigint, p_until date, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.meal_batches;
begin
  perform portal.require_life_owner(p_access_hash);
  select * into v from portal.meal_batches where gid = p_batch;
  if not found then
    raise exception 'That batch no longer exists.' using errcode = 'P0002';
  end if;
  if p_until is not null and v.location <> 'fridge' then
    raise exception 'Only food in the fridge has an eat-by.' using errcode = '22023';
  end if;
  if p_until is not null and (p_until <= v.cooked_on or p_until > v.cooked_on + 7) then
    raise exception 'Too long after it was cooked.' using errcode = '22023';
  end if;
  update portal.meal_batches set fine_until = p_until where gid = p_batch;
end;
$function$;

revoke all on function public.life_set_batch_fine_until(bigint, date, text) from public;
grant execute on function public.life_set_batch_fine_until(bigint, date, text) to anon, authenticated, service_role;
