-- Life: meals, the kitchen, the gym and the body. All of it is the owner's alone.
-- Mentors are never granted any of it, and none of it reaches Asana or the tasks.
--
--   life_profile      settings: body, goal, food rules, routine (one row, jsonb)
--   body_weights      one weigh-in a day
--   meal_plans        a meal week: what is cooked when, and the shopping state (jsonb)
--   meal_batches      cooked food in the fridge or freezer, by portions left
--   meal_log          what you ate (or skipped) at each meal
--   recipe_ratings    stars, so the menu learns what you like
--   kitchen_stock     ingredients at home, and staples as have / low / out
--   kitchen_products  the Sainsbury's product chosen for each ingredient
--   gym_sessions      one workout a day
--   gym_sets          every set, as it is done
--
-- The plan and profile are jsonb because their shape is the app's (validated in
-- src/lib/life/profile.ts); the logs are tables, so they stay checkable. The RPCs
-- take p_access_hash like the task RPCs, so the Claude connector can log a meal
-- or a set for the owner. Nothing here is untrusted text from outside: everything
-- is typed by the owner.

create table portal.life_profile (
  id         boolean primary key default true check (id),
  data       jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  updated_at timestamptz not null default now()
);

create table portal.body_weights (
  day        date primary key,
  kg         numeric(5, 2) not null check (kg between 30 and 250),
  created_at timestamptz not null default now()
);

create table portal.meal_plans (
  start      date primary key,
  data       jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 131072),
  updated_at timestamptz not null default now()
);

create table portal.meal_batches (
  gid        bigint generated always as identity primary key,
  recipe     text not null check (recipe ~ '^[a-z0-9-]{1,60}$'),
  cooked_on  date not null,
  portions   integer not null check (portions between 1 and 40),
  remaining  integer not null check (remaining between 0 and 40),
  scale      numeric(4, 2) not null default 1 check (scale between 0.25 and 3),
  location   text not null check (location in ('fridge', 'freezer')),
  plan_start date,
  cook_id    text check (cook_id is null or length(cook_id) between 1 and 120),
  -- Ingredients the cook took out of stock, so undoing it puts them back.
  used       jsonb not null default '[]' check (jsonb_typeof(used) = 'array'),
  created_at timestamptz not null default now()
);
-- A cook makes up to two batches: the portions for the fridge and those to freeze.
create unique index meal_batches_cook_idx on portal.meal_batches (plan_start, cook_id, location) where cook_id is not null;
create index meal_batches_open_idx on portal.meal_batches (cooked_on) where remaining > 0;

create table portal.meal_log (
  day       date not null,
  slot      text not null check (slot in ('breakfast', 'lunch', 'shake', 'dinner')),
  status    text not null check (status in ('eaten', 'skipped', 'swapped')),
  recipe    text check (recipe is null or recipe ~ '^[a-z0-9-]{1,60}$'),
  batch_gid bigint references portal.meal_batches (gid) on delete set null,
  kcal      integer check (kcal between 0 and 5000),
  protein   integer check (protein between 0 and 500),
  note      text check (note is null or length(note) <= 300),
  at        timestamptz not null default now(),
  primary key (day, slot)
);

create table portal.recipe_ratings (
  recipe     text primary key check (recipe ~ '^[a-z0-9-]{1,60}$'),
  stars      smallint not null check (stars between 1 and 5),
  note       text check (note is null or length(note) <= 300),
  updated_at timestamptz not null default now()
);

create table portal.kitchen_stock (
  item       text primary key check (item ~ '^[a-z0-9-]{1,60}$'),
  qty        numeric(10, 2) not null default 0 check (qty >= 0 and qty < 1000000),
  status     text check (status in ('have', 'low', 'out')),
  good_until date,
  updated_at timestamptz not null default now()
);

create table portal.kitchen_products (
  item       text primary key check (item ~ '^[a-z0-9-]{1,60}$'),
  -- Sainsbury's product pages only, so a stored link can never point elsewhere.
  url        text not null check (url ~ '^https://(www\.)?sainsburys\.co\.uk/(gol-ui|groceries|shop/gb/groceries)/product/[A-Za-z0-9._%-]{1,200}$'),
  name       text not null check (length(trim(name)) between 1 and 200),
  pack_qty   numeric(10, 2) not null check (pack_qty > 0 and pack_qty < 100000),
  pack_unit  text not null check (pack_unit in ('g', 'ml', 'each')),
  pence      integer check (pence is null or pence between 0 and 100000),
  checked    text[] not null default '{}' check (cardinality(checked) <= 40),
  updated_at timestamptz not null default now()
);

create table portal.gym_sessions (
  day         date primary key,
  workout     text not null check (workout ~ '^[A-Z]$'),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  feel        smallint check (feel is null or feel between 1 and 5),
  notes       text not null default '' check (length(notes) <= 1000)
);

create table portal.gym_sets (
  day      date not null references portal.gym_sessions (day) on delete cascade,
  exercise text not null check (exercise ~ '^[a-z0-9-]{1,60}$'),
  position smallint not null check (position between 1 and 20),
  kg       numeric(6, 2) check (kg is null or kg between 0 and 500),
  reps     smallint not null check (reps between 0 and 500),
  rir      smallint check (rir is null or rir between 0 and 10),
  done_at  timestamptz not null default now(),
  primary key (day, exercise, position)
);

do $$
declare t text;
begin
  foreach t in array array['life_profile', 'body_weights', 'meal_plans', 'meal_batches', 'meal_log', 'recipe_ratings', 'kitchen_stock', 'kitchen_products', 'gym_sessions', 'gym_sets'] loop
    execute format('alter table portal.%I enable row level security', t);
    execute format('revoke all on table portal.%I from public, anon, authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

create function portal.require_life_owner(p_access_hash text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can use Life.' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function portal.require_life_owner(text) from public, anon, authenticated;

-- Adds (or with p_sign -1 takes away) [{item, qty}] from stock, never below zero.
create function portal.life_stock_move(p_items jsonb, p_sign integer)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v jsonb;
begin
  for v in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into portal.kitchen_stock (item, qty)
    values (v->>'item', greatest(0, p_sign * (v->>'qty')::numeric))
    on conflict (item) do update
      set qty = greatest(0, portal.kitchen_stock.qty + p_sign * (v->>'qty')::numeric),
          updated_at = now();
  end loop;
end;
$function$;
revoke all on function portal.life_stock_move(jsonb, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- Everything the Life pages need from p_since on, plus what is current
-- (stock, products, ratings, food still in the fridge or freezer).
create function public.life_read(p_since date, p_access_hash text default null)
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
    'batches', coalesce((select jsonb_agg(jsonb_build_object('gid', gid::text, 'recipe', recipe, 'cooked_on', cooked_on, 'portions', portions, 'remaining', remaining, 'scale', scale, 'location', location, 'plan_start', plan_start, 'cook_id', cook_id) order by cooked_on, gid) from portal.meal_batches where remaining > 0 or cooked_on >= p_since - 14), '[]'),
    'ratings', coalesce((select jsonb_agg(jsonb_build_object('recipe', recipe, 'stars', stars, 'note', note)) from portal.recipe_ratings), '[]'),
    'last_had', coalesce((select jsonb_object_agg(recipe, last) from (select recipe, max(day) as last from portal.meal_log where recipe is not null and status = 'eaten' group by recipe) x), '{}'),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('item', item, 'qty', qty, 'status', status, 'good_until', good_until)) from portal.kitchen_stock), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object('item', item, 'url', url, 'name', name, 'pack_qty', pack_qty, 'pack_unit', pack_unit, 'pence', pence, 'checked', to_jsonb(checked))) from portal.kitchen_products), '[]'),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'workout', workout, 'finished', finished_at is not null, 'feel', feel, 'notes', notes) order by day) from portal.gym_sessions where day >= p_since - 180), '[]'),
    'sets', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'workout', g.workout, 'exercise', s.exercise, 'position', s.position, 'kg', s.kg, 'reps', s.reps, 'rir', s.rir) order by s.day, s.exercise, s.position) from portal.gym_sets s join portal.gym_sessions g using (day) where s.day >= p_since - 180), '[]')
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Settings, body and plans
-- ---------------------------------------------------------------------------

create function public.life_save_profile(p_data jsonb, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  insert into portal.life_profile (id, data) values (true, p_data)
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$function$;

-- A null weight removes that day's weigh-in.
create function public.life_log_weight(p_day date, p_kg numeric, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  if p_kg is null then
    delete from portal.body_weights where day = p_day;
  else
    insert into portal.body_weights (day, kg) values (p_day, round(p_kg, 2))
    on conflict (day) do update set kg = excluded.kg, created_at = now();
  end if;
end;
$function$;

-- A null plan removes the week.
create function public.life_save_plan(p_start date, p_data jsonb, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  if p_data is null then
    delete from portal.meal_plans where start = p_start;
  else
    insert into portal.meal_plans (start, data) values (p_start, p_data)
    on conflict (start) do update set data = excluded.data, updated_at = now();
  end if;
end;
$function$;

create function public.life_rate(p_recipe text, p_stars integer, p_note text default null, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  if p_stars is null then
    delete from portal.recipe_ratings where recipe = p_recipe;
  else
    insert into portal.recipe_ratings (recipe, stars, note) values (p_recipe, p_stars, nullif(trim(p_note), ''))
    on conflict (recipe) do update set stars = excluded.stars, note = coalesce(excluded.note, portal.recipe_ratings.note), updated_at = now();
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Eating, cooking and stock
-- ---------------------------------------------------------------------------

-- Logs a meal. Eating from a batch takes a portion; changing or clearing the log
-- gives it back, so a mis-tap never loses food. A null status clears the meal.
create function public.life_log_meal(
  p_day date,
  p_slot text,
  p_status text,
  p_recipe text default null,
  p_batch bigint default null,
  p_kcal integer default null,
  p_protein integer default null,
  p_note text default null,
  p_access_hash text default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_old portal.meal_log;
begin
  perform portal.require_life_owner(p_access_hash);
  select * into v_old from portal.meal_log where day = p_day and slot = p_slot for update;
  if v_old.batch_gid is not null and v_old.status = 'eaten' then
    update portal.meal_batches set remaining = least(portions, remaining + 1) where gid = v_old.batch_gid;
  end if;
  if p_status is null then
    delete from portal.meal_log where day = p_day and slot = p_slot;
    return;
  end if;
  if p_batch is not null and p_status = 'eaten' then
    update portal.meal_batches set remaining = greatest(0, remaining - 1) where gid = p_batch;
    if not found then
      raise exception 'That batch no longer exists.' using errcode = 'P0002';
    end if;
  end if;
  insert into portal.meal_log (day, slot, status, recipe, batch_gid, kcal, protein, note)
  values (p_day, p_slot, p_status, p_recipe, p_batch, p_kcal, p_protein, nullif(trim(p_note), ''))
  on conflict (day, slot) do update
    set status = excluded.status, recipe = excluded.recipe, batch_gid = excluded.batch_gid,
        kcal = excluded.kcal, protein = excluded.protein, note = excluded.note, at = now();
end;
$function$;

-- A cook: its portions go in the fridge, p_freeze of them in the freezer, and its
-- ingredients come out of stock, in one step. A planned cook is logged once.
-- Returns the fridge batch, or the freezer one when everything is frozen.
create function public.life_cook(
  p_recipe text,
  p_day date,
  p_portions integer,
  p_scale numeric,
  p_freeze integer,
  p_used jsonb,
  p_plan_start date default null,
  p_cook_id text default null,
  p_access_hash text default null
)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_fridge bigint;
  v_freezer bigint;
  v_freeze integer := least(greatest(coalesce(p_freeze, 0), 0), p_portions);
begin
  perform portal.require_life_owner(p_access_hash);
  if p_cook_id is not null and exists (select 1 from portal.meal_batches where plan_start is not distinct from p_plan_start and cook_id = p_cook_id) then
    raise exception 'That cook is already logged.' using errcode = '22023';
  end if;
  if p_portions - v_freeze > 0 then
    insert into portal.meal_batches (recipe, cooked_on, portions, remaining, scale, location, plan_start, cook_id, used)
    values (p_recipe, p_day, p_portions - v_freeze, p_portions - v_freeze, p_scale, 'fridge', p_plan_start, p_cook_id, coalesce(p_used, '[]'))
    returning gid into v_fridge;
  end if;
  if v_freeze > 0 then
    -- The used ingredients live on one row only, so undoing restores them once.
    insert into portal.meal_batches (recipe, cooked_on, portions, remaining, scale, location, plan_start, cook_id, used)
    values (p_recipe, p_day, v_freeze, v_freeze, p_scale, 'freezer', p_plan_start, p_cook_id, case when v_fridge is null then coalesce(p_used, '[]') else '[]' end)
    returning gid into v_freezer;
  end if;
  perform portal.life_stock_move(p_used, -1);
  return coalesce(v_fridge, v_freezer)::text;
end;
$function$;

-- Undoes a cook: its batches go (fridge and freezer alike) and the ingredients
-- go back into stock.
create function public.life_uncook(p_batch bigint, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_row portal.meal_batches;
  v_used jsonb := '[]';
  v_one jsonb;
begin
  perform portal.require_life_owner(p_access_hash);
  select * into v_row from portal.meal_batches where gid = p_batch;
  if not found then
    raise exception 'That batch no longer exists.' using errcode = 'P0002';
  end if;
  for v_one in
    delete from portal.meal_batches
     where gid = p_batch
        or (v_row.cook_id is not null and cook_id = v_row.cook_id and plan_start is not distinct from v_row.plan_start)
    returning used
  loop
    v_used := v_used || v_one;
  end loop;
  perform portal.life_stock_move(v_used, 1);
end;
$function$;

-- Moves a batch between fridge and freezer, or corrects its portions.
create function public.life_set_batch(p_batch bigint, p_remaining integer, p_location text, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  update portal.meal_batches
     set remaining = coalesce(least(p_remaining, portions), remaining),
         location = coalesce(p_location, location)
   where gid = p_batch;
  if not found then
    raise exception 'That batch no longer exists.' using errcode = 'P0002';
  end if;
end;
$function$;

-- Stock changes: [{item, qty?, status?, good_until?}]. 'add' adds qty (a
-- delivery), 'set' replaces it (a stock check). Status and date replace when given.
create function public.life_stock(p_changes jsonb, p_mode text, p_access_hash text default null)
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
  perform portal.require_life_owner(p_access_hash);
  if p_mode not in ('add', 'set') then
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

-- The Sainsbury's product for an ingredient. A null url removes it.
create function public.life_save_product(
  p_item text,
  p_url text,
  p_name text default null,
  p_pack_qty numeric default null,
  p_pack_unit text default null,
  p_pence integer default null,
  p_checked text[] default '{}',
  p_access_hash text default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  if p_url is null then
    delete from portal.kitchen_products where item = p_item;
    return;
  end if;
  insert into portal.kitchen_products (item, url, name, pack_qty, pack_unit, pence, checked)
  values (p_item, p_url, trim(p_name), p_pack_qty, p_pack_unit, p_pence, coalesce(p_checked, '{}'))
  on conflict (item) do update
    set url = excluded.url, name = excluded.name, pack_qty = excluded.pack_qty, pack_unit = excluded.pack_unit,
        pence = excluded.pence, checked = excluded.checked, updated_at = now();
end;
$function$;

-- ---------------------------------------------------------------------------
-- Gym
-- ---------------------------------------------------------------------------

-- Logs one set, starting the day's session if needed. Null reps removes the set.
create function public.gym_log_set(
  p_day date,
  p_workout text,
  p_exercise text,
  p_position integer,
  p_kg numeric,
  p_reps integer,
  p_rir integer default null,
  p_access_hash text default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  if p_reps is null then
    delete from portal.gym_sets where day = p_day and exercise = p_exercise and position = p_position;
    return;
  end if;
  insert into portal.gym_sessions (day, workout) values (p_day, p_workout)
  on conflict (day) do nothing;
  insert into portal.gym_sets (day, exercise, position, kg, reps, rir)
  values (p_day, p_exercise, p_position, p_kg, p_reps, p_rir)
  on conflict (day, exercise, position) do update
    set kg = excluded.kg, reps = excluded.reps, rir = excluded.rir, done_at = now();
end;
$function$;

-- Starts, finishes or reopens the day's session. p_delete removes it and its sets.
create function public.gym_session(
  p_day date,
  p_workout text,
  p_finished boolean default false,
  p_feel integer default null,
  p_notes text default null,
  p_delete boolean default false,
  p_access_hash text default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  if p_delete then
    delete from portal.gym_sessions where day = p_day;
    return;
  end if;
  insert into portal.gym_sessions (day, workout, finished_at, feel, notes)
  values (p_day, p_workout, case when p_finished then now() end, p_feel, coalesce(trim(p_notes), ''))
  on conflict (day) do update
    set workout = excluded.workout,
        finished_at = case when p_finished then coalesce(portal.gym_sessions.finished_at, now()) end,
        feel = coalesce(excluded.feel, portal.gym_sessions.feel),
        notes = case when p_notes is null then portal.gym_sessions.notes else excluded.notes end;
end;
$function$;

-- Each function checks for the owner itself. anon too: connector calls have no
-- session and prove themselves with p_access_hash.
do $$
declare f text;
begin
  foreach f in array array[
    'life_read(date, text)',
    'life_save_profile(jsonb, text)',
    'life_log_weight(date, numeric, text)',
    'life_save_plan(date, jsonb, text)',
    'life_rate(text, integer, text, text)',
    'life_log_meal(date, text, text, text, bigint, integer, integer, text, text)',
    'life_cook(text, date, integer, numeric, integer, jsonb, date, text, text)',
    'life_uncook(bigint, text)',
    'life_set_batch(bigint, integer, text, text)',
    'life_stock(jsonb, text, text)',
    'life_save_product(text, text, text, numeric, text, integer, text[], text)',
    'gym_log_set(date, text, text, integer, numeric, integer, integer, text)',
    'gym_session(date, text, boolean, integer, text, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
