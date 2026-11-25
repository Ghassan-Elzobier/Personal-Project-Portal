-- Life: private to-dos. Personal admin, errands and deadlines ("cancel the trial
-- before it renews"), the owner's alone. Like the rest of Life, mentors are never
-- granted any of it, and none of it reaches the tasks, their status updates or the
-- study calendar. Tasks stay for study work that mentors follow.
--
--   life_todos   one row a to-do: what to do, the day it is due (or none), and
--                when it was ticked off
--
-- Every function checks for the owner first, from a session or a live connector
-- token (p_access_hash), as the other Life functions do (20261112120000_life.sql).
-- Nothing else changes, so the code before this migration runs on as it did.

create table portal.life_todos (
  gid        bigint generated always as identity primary key,
  title      text not null check (length(trim(title)) between 1 and 200),
  due_on     date,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Today and the page read what is still open, by day.
create index life_todos_open_idx on portal.life_todos (due_on) where done_at is null;

alter table portal.life_todos enable row level security;
revoke all on table portal.life_todos from public, anon, authenticated;

-- One to-do as the API returns it. gid is text, as the other Life gids are.
create function portal.life_todo_json(t portal.life_todos)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object('gid', t.gid::text, 'title', t.title, 'due_on', t.due_on,
                            'done_at', t.done_at, 'created_at', t.created_at);
$function$;
revoke all on function portal.life_todo_json(portal.life_todos) from public, anon, authenticated;

-- Every open to-do, and those ticked off since p_done_since (none when it is null).
create function public.life_read_todos(p_done_since timestamptz default null, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_life_owner(p_access_hash);
  return coalesce((select jsonb_agg(portal.life_todo_json(t) order by t.gid)
                   from portal.life_todos t
                   where t.done_at is null or t.done_at >= p_done_since), '[]');
end;
$function$;

create function public.life_add_todo(p_title text, p_due_on date default null, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.life_todos;
begin
  perform portal.require_life_owner(p_access_hash);
  insert into portal.life_todos (title, due_on) values (trim(p_title), p_due_on) returning * into v;
  return portal.life_todo_json(v);
end;
$function$;

-- Changes only the keys given: title (text), due_on (a day, or null for no day)
-- and done (true ticks it off, false puts it back).
create function public.life_set_todo(p_gid bigint, p_changes jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.life_todos;
begin
  perform portal.require_life_owner(p_access_hash);
  if jsonb_typeof(p_changes) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('title', 'due_on', 'done')) then
    raise exception 'A to-do changes its title, its day or whether it is done.' using errcode = '22023';
  end if;
  if p_changes ? 'title' and jsonb_typeof(p_changes->'title') is distinct from 'string' then
    raise exception 'A to-do''s title is text.' using errcode = '22023';
  end if;
  if p_changes ? 'done' and jsonb_typeof(p_changes->'done') is distinct from 'boolean' then
    raise exception 'Done is true or false.' using errcode = '22023';
  end if;
  update portal.life_todos t
  set title = case when p_changes ? 'title' then trim(p_changes->>'title') else t.title end,
      due_on = case when p_changes ? 'due_on' then (p_changes->>'due_on')::date else t.due_on end,
      done_at = case
        when not p_changes ? 'done' then t.done_at
        when (p_changes->>'done')::boolean then coalesce(t.done_at, now())
      end,
      updated_at = now()
  where t.gid = p_gid
  returning * into v;
  if not found then
    raise exception 'That to-do is not there any more.' using errcode = 'P0002';
  end if;
  return portal.life_todo_json(v);
end;
$function$;

-- Deletes one for good, and returns it, so the caller can say what went.
create function public.life_remove_todo(p_gid bigint, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.life_todos;
begin
  perform portal.require_life_owner(p_access_hash);
  delete from portal.life_todos t where t.gid = p_gid returning * into v;
  if not found then
    raise exception 'That to-do is not there any more.' using errcode = 'P0002';
  end if;
  return portal.life_todo_json(v);
end;
$function$;

-- Each function checks for the owner itself. anon too: connector calls have no
-- session and prove themselves with p_access_hash.
do $$
declare f text;
begin
  foreach f in array array[
    'life_read_todos(timestamptz, text)',
    'life_add_todo(text, date, text)',
    'life_set_todo(bigint, jsonb, text)',
    'life_remove_todo(bigint, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
