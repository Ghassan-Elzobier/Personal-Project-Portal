-- The owner's study pace: so many hours a week from a start day, and maybe a
-- different number from a later day (a job starting). The Study page saves it
-- when it sets the roadmap's dates, and Today's weekly bar and the Sunday update
-- count against it. Until now the pace was used once for the dates and forgotten,
-- and the weekly target was a setting of the deployment that knew nothing of it.
--
-- One row at most. There is none until a pace is set: the app then keeps using
-- the deployment's number, so nothing changes for a database with no pace.

create table portal.study_pace (
  id                  boolean primary key default true check (id),
  hours_per_week      numeric(5, 2) not null check (hours_per_week > 0 and hours_per_week <= 100),
  starts_on           date not null,
  -- The day the pace changes and the hours from then on: both, or neither.
  changes_on          date,
  then_hours_per_week numeric(5, 2) check (then_hours_per_week > 0 and then_hours_per_week <= 100),
  updated_at          timestamptz not null default now(),
  constraint study_pace_change_is_whole check ((changes_on is null) = (then_hours_per_week is null)),
  constraint study_pace_change_is_later check (changes_on is null or changes_on > starts_on)
);

alter table portal.study_pace enable row level security;
revoke all on table portal.study_pace from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: the owner alone, from a browser session or Claude's connector
-- ---------------------------------------------------------------------------

-- The saved pace, or null when none is set.
create function public.get_study_pace(p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can see the study pace.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'hours_per_week', p.hours_per_week,
      'starts_on', p.starts_on,
      'changes_on', p.changes_on,
      'then_hours_per_week', p.then_hours_per_week)
    from portal.study_pace p
  );
end;
$function$;

-- Saves the pace in the shape get_study_pace returns it, replacing the one before.
-- A null pace forgets it, and the deployment's number counts again.
create function public.set_study_pace(p_pace jsonb, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_hours  numeric;
  v_start  date;
  v_change date;
  v_then   numeric;
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can set the study pace.' using errcode = '42501';
  end if;

  if p_pace is null or jsonb_typeof(p_pace) = 'null' then
    -- With its WHERE: the API's roles load safeupdate, which refuses a DELETE without one.
    delete from portal.study_pace where id;
    return;
  end if;
  if jsonb_typeof(p_pace) <> 'object' then
    raise exception 'Send the pace as an object.' using errcode = '22023';
  end if;

  v_hours  := (p_pace ->> 'hours_per_week')::numeric;
  v_start  := (p_pace ->> 'starts_on')::date;
  v_change := (p_pace ->> 'changes_on')::date;
  v_then   := (p_pace ->> 'then_hours_per_week')::numeric;

  if v_hours is null or v_hours <= 0 or v_hours > 100 then
    raise exception 'Hours a week must be more than 0 and at most 100.' using errcode = '22023';
  end if;
  if v_start is null then
    raise exception 'The pace needs the day it starts.' using errcode = '22023';
  end if;
  if (v_change is null) <> (v_then is null) then
    raise exception 'A change of pace needs both its day and its hours.' using errcode = '22023';
  end if;
  if v_change is not null and v_change <= v_start then
    raise exception 'The pace can only change after the day it starts.' using errcode = '22023';
  end if;
  if v_then is not null and (v_then <= 0 or v_then > 100) then
    raise exception 'Hours a week must be more than 0 and at most 100.' using errcode = '22023';
  end if;

  insert into portal.study_pace (id, hours_per_week, starts_on, changes_on, then_hours_per_week)
  values (true, v_hours, v_start, v_change, v_then)
  on conflict (id) do update
    set hours_per_week = excluded.hours_per_week,
        starts_on = excluded.starts_on,
        changes_on = excluded.changes_on,
        then_hours_per_week = excluded.then_hours_per_week,
        updated_at = now();
end;
$function$;

-- Connector calls arrive as anon and prove themselves with p_access_hash, as the
-- tracker_* functions' calls do; the owner check above is what lets a call in.
do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.get_study_pace(text)',
    'public.set_study_pace(jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
  end loop;
end;
$grants$;
