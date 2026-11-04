-- Tasks in the portal itself, for running without Asana (TASK_BACKEND=native).
--
-- The tables follow Asana's model on purpose: projects hold sections and tasks,
-- tasks hold comments, and projects hold status updates. Stage, Hours and
-- Evidence are plain columns here and custom fields in Asana. That keeps a
-- later move to Asana a matter of copying rows.
--
-- Like the access tables these live in the private `portal` schema, reached
-- only through the RPCs below. Owners read and change everything. Mentors read
-- the projects granted to them and change nothing.
--
-- Claude's connector has no Supabase session, so each RPC also takes
-- p_access_hash: the SHA-256 of a live connector token, the same secret
-- mcp_session checks. Browser calls leave it null and rely on auth.uid().
--
-- Project keys are text in the RPC signatures: the API roles cannot use the
-- portal schema, so PostgREST could not call a function with its types.

create type portal.task_stage as enum (
  'Not started',
  'In progress',
  'Blocked',
  'Needs review',
  'Done'
);

create table portal.sections (
  gid        bigint generated always as identity primary key,
  project    portal.project_key not null,
  name       text not null check (length(trim(name)) between 1 and 120),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index sections_project_idx on portal.sections (project, position, gid);

create table portal.tasks (
  gid              bigint generated always as identity primary key,
  project          portal.project_key not null,
  section_gid      bigint references portal.sections (gid) on delete set null,
  name             text not null check (length(trim(name)) between 1 and 500),
  notes            text not null default '' check (length(notes) <= 20000),
  resource_subtype text not null default 'default_task' check (resource_subtype in ('default_task', 'milestone')),
  completed        boolean not null default false,
  completed_at     timestamptz,
  start_on         date,
  due_on           date,
  start_at         timestamptz,
  due_at           timestamptz,
  stage            portal.task_stage not null default 'Not started',
  hours            numeric(8, 2) not null default 0 check (hours >= 0),
  evidence         text check (evidence is null or length(evidence) <= 2000),
  created_at       timestamptz not null default now(),
  modified_at      timestamptz not null default now()
);
create index tasks_project_idx on portal.tasks (project, gid);

create table portal.task_comments (
  gid        bigint generated always as identity primary key,
  task_gid   bigint not null references portal.tasks (gid) on delete cascade,
  text       text not null check (length(trim(text)) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on portal.task_comments (task_gid, created_at);

create table portal.status_updates (
  gid         bigint generated always as identity primary key,
  project     portal.project_key not null,
  title       text not null check (length(trim(title)) between 1 and 200),
  text        text not null check (length(text) between 1 and 10000),
  status_type text not null check (status_type in ('on_track', 'at_risk', 'off_track')),
  created_at  timestamptz not null default now()
);
create index status_updates_project_idx on portal.status_updates (project, created_at desc);

alter table portal.sections enable row level security;
alter table portal.tasks enable row level security;
alter table portal.task_comments enable row level security;
alter table portal.status_updates enable row level security;
revoke all on table portal.sections, portal.tasks, portal.task_comments, portal.status_updates
  from public, anon, authenticated;

-- Each project starts with one section, as a new Asana project does.
insert into portal.sections (project, name)
select k, 'To do' from unnest(enum_range(null::portal.project_key)) k;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- The account behind a call: the connector token's owner, or the session user.
create function portal.task_caller(p_access_hash text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when p_access_hash is null then auth.uid()
    else (select t.account_id from portal.mcp_tokens t
          where t.access_hash = p_access_hash and t.access_expires_at > now())
  end;
$function$;

create function portal.require_task_owner(p_access_hash text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can change tasks.' using errcode = '42501';
  end if;
end;
$function$;

-- Unknown and unshared projects raise the same error, so nothing leaks.
create function portal.require_task_read(p_project text, p_access_hash text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_account uuid := portal.task_caller(p_access_hash);
begin
  if v_account is null
     or not (portal.is_owner(v_account)
             or exists (select 1 from portal.mentor_projects p
                        where p.account_id = v_account and p.project::text = p_project)) then
    raise exception 'You do not have access to that project.' using errcode = '42501';
  end if;
end;
$function$;

create function portal.task_json(t portal.tasks)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'gid', t.gid::text,
    'project', t.project::text,
    'section_gid', t.section_gid::text,
    'section_name', (select s.name from portal.sections s where s.gid = t.section_gid),
    'name', t.name,
    'notes', t.notes,
    'resource_subtype', t.resource_subtype,
    'completed', t.completed,
    'completed_at', t.completed_at,
    'start_on', t.start_on,
    'due_on', t.due_on,
    'start_at', t.start_at,
    'due_at', t.due_at,
    'stage', t.stage::text,
    'hours', t.hours,
    'evidence', t.evidence,
    'modified_at', t.modified_at
  );
$function$;

revoke all on function portal.task_caller(text) from public, anon, authenticated;
revoke all on function portal.require_task_owner(text) from public, anon, authenticated;
revoke all on function portal.require_task_read(text, text) from public, anon, authenticated;
revoke all on function portal.task_json(portal.tasks) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create function public.tracker_sections(p_project text, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_read(p_project, p_access_hash);
  return coalesce(
    (select jsonb_agg(jsonb_build_object('gid', s.gid::text, 'name', s.name) order by s.position, s.gid)
     from portal.sections s where s.project = p_project::portal.project_key),
    '[]'::jsonb);
end;
$function$;

-- p_completed_since keeps open tasks plus those finished since then, and
-- p_modified_since keeps tasks changed since then, as Asana's filters do.
create function public.tracker_tasks(
  p_project text,
  p_completed_since timestamptz default null,
  p_modified_since timestamptz default null,
  p_access_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_read(p_project, p_access_hash);
  return coalesce(
    (select jsonb_agg(portal.task_json(t) order by t.gid)
     from portal.tasks t
     where t.project = p_project::portal.project_key
       and (p_completed_since is null or not t.completed or t.completed_at >= p_completed_since)
       and (p_modified_since is null or t.modified_at >= p_modified_since)),
    '[]'::jsonb);
end;
$function$;

create function public.tracker_task(p_gid bigint, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_task portal.tasks;
begin
  select * into v_task from portal.tasks where gid = p_gid;
  if not found then
    -- Owners learn it is gone. Anyone else gets the usual refusal.
    perform portal.require_task_owner(p_access_hash);
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  perform portal.require_task_read(v_task.project::text, p_access_hash);
  return portal.task_json(v_task);
end;
$function$;

create function public.tracker_comments(p_gid bigint, p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_project portal.project_key;
begin
  select project into v_project from portal.tasks where gid = p_gid;
  if not found then
    perform portal.require_task_owner(p_access_hash);
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  perform portal.require_task_read(v_project::text, p_access_hash);
  return coalesce(
    (select jsonb_agg(jsonb_build_object('gid', c.gid::text, 'text', c.text, 'created_at', c.created_at) order by c.created_at, c.gid)
     from portal.task_comments c where c.task_gid = p_gid),
    '[]'::jsonb);
end;
$function$;

create function public.tracker_status_updates(
  p_project text,
  p_since timestamptz default null,
  p_access_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_read(p_project, p_access_hash);
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
              'gid', u.gid::text, 'title', u.title, 'text', u.text,
              'status_type', u.status_type, 'created_at', u.created_at)
            order by u.created_at desc, u.gid desc)
     from portal.status_updates u
     where u.project = p_project::portal.project_key and (p_since is null or u.created_at >= p_since)),
    '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Changes (owner only)
-- ---------------------------------------------------------------------------

create function public.tracker_create_section(p_project text, p_name text, p_access_hash text default null)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_gid bigint;
begin
  perform portal.require_task_owner(p_access_hash);
  insert into portal.sections (project, name, position)
  values (
    p_project::portal.project_key,
    trim(p_name),
    (select coalesce(max(s.position), 0) + 1 from portal.sections s where s.project = p_project::portal.project_key))
  returning gid into v_gid;
  return v_gid::text;
end;
$function$;

-- Tasks in the section stay, with no section.
create function public.tracker_delete_section(p_gid bigint, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  delete from portal.sections where gid = p_gid;
end;
$function$;

create function public.tracker_create_task(
  p_project text,
  p_name text,
  p_section_gid bigint default null,
  p_due_on date default null,
  p_milestone boolean default false,
  p_access_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_task portal.tasks;
begin
  perform portal.require_task_owner(p_access_hash);
  if p_section_gid is not null
     and not exists (select 1 from portal.sections s where s.gid = p_section_gid and s.project = p_project::portal.project_key) then
    raise exception 'That section is not in this project.' using errcode = '22023';
  end if;
  insert into portal.tasks (project, section_gid, name, due_on, resource_subtype)
  values (p_project::portal.project_key, p_section_gid, trim(p_name), p_due_on, case when p_milestone then 'milestone' else 'default_task' end)
  returning * into v_task;
  return portal.task_json(v_task);
end;
$function$;

-- Applies only the keys present in p_changes. As in Asana, a date and a time
-- for the same end of a task replace each other, and completed_at follows
-- completed.
create function public.tracker_update_task(p_gid bigint, p_changes jsonb, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_task portal.tasks;
  v_section bigint;
begin
  perform portal.require_task_owner(p_access_hash);
  select * into v_task from portal.tasks where gid = p_gid for update;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;

  if p_changes ? 'section_gid' then
    v_section := (p_changes ->> 'section_gid')::bigint;
    if v_section is not null
       and not exists (select 1 from portal.sections s where s.gid = v_section and s.project = v_task.project) then
      raise exception 'That section is not in this project.' using errcode = '22023';
    end if;
    v_task.section_gid := v_section;
  end if;

  if p_changes ? 'name' then v_task.name := trim(p_changes ->> 'name'); end if;
  if p_changes ? 'notes' then v_task.notes := coalesce(p_changes ->> 'notes', ''); end if;
  if p_changes ? 'stage' then v_task.stage := (p_changes ->> 'stage')::portal.task_stage; end if;
  if p_changes ? 'hours' then v_task.hours := coalesce((p_changes ->> 'hours')::numeric, 0); end if;
  if p_changes ? 'evidence' then v_task.evidence := nullif(trim(p_changes ->> 'evidence'), ''); end if;

  if p_changes ? 'start_on' then
    v_task.start_on := (p_changes ->> 'start_on')::date;
    v_task.start_at := null;
  end if;
  if p_changes ? 'due_on' then
    v_task.due_on := (p_changes ->> 'due_on')::date;
    v_task.due_at := null;
  end if;
  if p_changes ? 'start_at' then
    v_task.start_at := (p_changes ->> 'start_at')::timestamptz;
    if v_task.start_at is not null then v_task.start_on := null; end if;
  end if;
  if p_changes ? 'due_at' then
    v_task.due_at := (p_changes ->> 'due_at')::timestamptz;
    if v_task.due_at is not null then v_task.due_on := null; end if;
  end if;

  if p_changes ? 'completed' then
    if (p_changes ->> 'completed')::boolean and not v_task.completed then
      v_task.completed := true;
      v_task.completed_at := now();
    elsif not (p_changes ->> 'completed')::boolean then
      v_task.completed := false;
      v_task.completed_at := null;
    end if;
  end if;

  update portal.tasks t set
    section_gid = v_task.section_gid,
    name = v_task.name,
    notes = v_task.notes,
    stage = v_task.stage,
    hours = v_task.hours,
    evidence = v_task.evidence,
    start_on = v_task.start_on,
    due_on = v_task.due_on,
    start_at = v_task.start_at,
    due_at = v_task.due_at,
    completed = v_task.completed,
    completed_at = v_task.completed_at,
    modified_at = now()
  where t.gid = p_gid;
end;
$function$;

create function public.tracker_delete_task(p_gid bigint, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  delete from portal.tasks where gid = p_gid;
end;
$function$;

-- A new comment counts as a change to the task, so the Sunday update finds it
-- through p_modified_since.
create function public.tracker_add_comment(p_gid bigint, p_text text, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  update portal.tasks set modified_at = now() where gid = p_gid;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  insert into portal.task_comments (task_gid, text) values (p_gid, p_text);
end;
$function$;

create function public.tracker_add_status_update(
  p_project text,
  p_title text,
  p_text text,
  p_status_type text,
  p_access_hash text default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  insert into portal.status_updates (project, title, text, status_type)
  values (p_project::portal.project_key, p_title, p_text, p_status_type);
end;
$function$;

-- The connector calls these as anon, so anon may execute them. Each one still
-- needs a session user with access or a live connector token.
do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.tracker_sections(text, text)',
    'public.tracker_tasks(text, timestamptz, timestamptz, text)',
    'public.tracker_task(bigint, text)',
    'public.tracker_comments(bigint, text)',
    'public.tracker_status_updates(text, timestamptz, text)',
    'public.tracker_create_section(text, text, text)',
    'public.tracker_delete_section(bigint, text)',
    'public.tracker_create_task(text, text, bigint, date, boolean, text)',
    'public.tracker_update_task(bigint, jsonb, text)',
    'public.tracker_delete_task(bigint, text)',
    'public.tracker_add_comment(bigint, text, text)',
    'public.tracker_add_status_update(text, text, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
  end loop;
end;
$grants$;
