-- Clients: software the owner builds for other people. It sits in the Work space
-- but belongs to the owner alone: like Life, mentors are never granted any of it,
-- and none of it reaches the tasks, their status updates or the study calendar.
-- Client names, prices and plans are private, so they live only here.
--
--   clients            one row a client: a name, how the owner knows them, where
--                      they talk, their time zone and notes
--   client_projects    what is being built for a client: its stage, how it is
--                      priced, and its repo, preview and live links
--   client_milestones  a project's deliverables: the day each is due, the amount
--                      agreed, and the days it was accepted and paid
--
-- Every function checks for the owner first, from a session or a live connector
-- token (p_access_hash), as the Life functions do (20261112120000_life.sql).
-- Nothing else changes, so the code before this migration runs on as it did.

create table portal.clients (
  gid          bigint generated always as identity primary key,
  name         text not null check (length(trim(name)) between 1 and 120),
  relationship text not null default 'referral'
               check (relationship in ('family', 'friend', 'referral', 'other')),
  channel      text check (channel is null or length(channel) between 1 and 80),
  time_zone    text check (time_zone is null or length(time_zone) between 1 and 64),
  notes        text check (notes is null or length(notes) between 1 and 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table portal.client_projects (
  gid         bigint generated always as identity primary key,
  client_gid  bigint not null references portal.clients (gid) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 120),
  stage       text not null default 'lead'
              check (stage in ('lead', 'scoping', 'agreed', 'building', 'handed_over', 'support', 'closed')),
  pricing     text not null default 'fixed' check (pricing in ('fixed', 'day_rate', 'unpaid')),
  repo_url    text check (repo_url is null or (repo_url ~ '^https://\S+$' and length(repo_url) <= 300)),
  preview_url text check (preview_url is null or (preview_url ~ '^https://\S+$' and length(preview_url) <= 300)),
  live_url    text check (live_url is null or (live_url ~ '^https://\S+$' and length(live_url) <= 300)),
  notes       text check (notes is null or length(notes) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index client_projects_client_idx on portal.client_projects (client_gid);

create table portal.client_milestones (
  gid          bigint generated always as identity primary key,
  project_gid  bigint not null references portal.client_projects (gid) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 200),
  due_on       date,
  amount_pence integer check (amount_pence is null or amount_pence between 0 and 100000000),
  accepted_on  date,
  paid_on      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index client_milestones_project_idx on portal.client_milestones (project_gid);

alter table portal.clients enable row level security;
alter table portal.client_projects enable row level security;
alter table portal.client_milestones enable row level security;
revoke all on table portal.clients, portal.client_projects, portal.client_milestones from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers, closed to the API roles
-- ---------------------------------------------------------------------------

create function portal.require_clients_owner(p_access_hash text)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not coalesce(portal.is_owner(portal.task_caller(p_access_hash)), false) then
    raise exception 'Only the owner can use Clients.' using errcode = '42501';
  end if;
end;
$function$;

-- Checks a set of changes against the keys a record takes and the JSON types each
-- key allows, written like '{"title": "string", "notes": "string|null"}'.
create function portal.clients_check_changes(p_changes jsonb, p_types jsonb)
returns void
language plpgsql
immutable
security definer
set search_path to ''
as $function$
declare
  k text;
begin
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Changes come as an object of the fields to change.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not p_types ? k then
      raise exception 'This record has no field "%".', k using errcode = '22023';
    end if;
    if not (jsonb_typeof(p_changes -> k) = any (string_to_array(p_types ->> k, '|'))) then
      raise exception 'The field "%" takes %.', k, replace(p_types ->> k, '|', ' or ') using errcode = '22023';
    end if;
  end loop;
end;
$function$;

-- Records as the API returns them. Gids are text, as the other gids are.
create function portal.client_json(c portal.clients)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object('gid', c.gid::text, 'name', c.name, 'relationship', c.relationship,
                            'channel', c.channel, 'time_zone', c.time_zone, 'notes', c.notes);
$function$;

create function portal.client_project_json(p portal.client_projects)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object('gid', p.gid::text, 'client_gid', p.client_gid::text, 'title', p.title,
                            'stage', p.stage, 'pricing', p.pricing, 'repo_url', p.repo_url,
                            'preview_url', p.preview_url, 'live_url', p.live_url, 'notes', p.notes);
$function$;

create function portal.client_milestone_json(m portal.client_milestones)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object('gid', m.gid::text, 'project_gid', m.project_gid::text, 'title', m.title,
                            'due_on', m.due_on, 'amount_pence', m.amount_pence,
                            'accepted_on', m.accepted_on, 'paid_on', m.paid_on);
$function$;

revoke all on function portal.require_clients_owner(text) from public, anon, authenticated;
revoke all on function portal.clients_check_changes(jsonb, jsonb) from public, anon, authenticated;
revoke all on function portal.client_json(portal.clients) from public, anon, authenticated;
revoke all on function portal.client_project_json(portal.client_projects) from public, anon, authenticated;
revoke all on function portal.client_milestone_json(portal.client_milestones) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- Every client, project and milestone. The page and Claude put the tree together.
create function public.clients_read(p_access_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform portal.require_clients_owner(p_access_hash);
  return jsonb_build_object(
    'clients', coalesce((select jsonb_agg(portal.client_json(c) order by c.gid) from portal.clients c), '[]'),
    'projects', coalesce((select jsonb_agg(portal.client_project_json(p) order by p.gid)
                          from portal.client_projects p), '[]'),
    'milestones', coalesce((select jsonb_agg(portal.client_milestone_json(m) order by m.due_on nulls last, m.gid)
                            from portal.client_milestones m), '[]')
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------

create function public.clients_add_client(
  p_name text,
  p_relationship text default 'referral',
  p_channel text default null,
  p_access_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.clients;
begin
  perform portal.require_clients_owner(p_access_hash);
  insert into portal.clients (name, relationship, channel)
  values (trim(p_name), coalesce(p_relationship, 'referral'), nullif(trim(p_channel), ''))
  returning * into v;
  return portal.client_json(v);
end;
$function$;

-- Changes only the keys given: name, relationship, channel, time_zone and notes
-- (null, or blank text, clears the last three).
create function public.clients_set_client(p_gid bigint, p_changes jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.clients;
begin
  perform portal.require_clients_owner(p_access_hash);
  perform portal.clients_check_changes(p_changes, '{"name": "string", "relationship": "string",
    "channel": "string|null", "time_zone": "string|null", "notes": "string|null"}');
  update portal.clients c
  set name = case when p_changes ? 'name' then trim(p_changes ->> 'name') else c.name end,
      relationship = case when p_changes ? 'relationship' then p_changes ->> 'relationship' else c.relationship end,
      channel = case when p_changes ? 'channel' then nullif(trim(p_changes ->> 'channel'), '') else c.channel end,
      time_zone = case when p_changes ? 'time_zone' then nullif(trim(p_changes ->> 'time_zone'), '') else c.time_zone end,
      notes = case when p_changes ? 'notes' then nullif(trim(p_changes ->> 'notes'), '') else c.notes end,
      updated_at = now()
  where c.gid = p_gid
  returning * into v;
  if not found then
    raise exception 'That client is not there any more.' using errcode = 'P0002';
  end if;
  return portal.client_json(v);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create function public.clients_add_project(
  p_client_gid bigint,
  p_title text,
  p_pricing text default 'fixed',
  p_access_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.client_projects;
begin
  perform portal.require_clients_owner(p_access_hash);
  if not exists (select 1 from portal.clients c where c.gid = p_client_gid) then
    raise exception 'That client is not there any more.' using errcode = 'P0002';
  end if;
  insert into portal.client_projects (client_gid, title, pricing)
  values (p_client_gid, trim(p_title), coalesce(p_pricing, 'fixed'))
  returning * into v;
  return portal.client_project_json(v);
end;
$function$;

-- Changes only the keys given: title, stage, pricing, the three links and notes
-- (null, or blank text, clears a link or the notes).
create function public.clients_set_project(p_gid bigint, p_changes jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.client_projects;
begin
  perform portal.require_clients_owner(p_access_hash);
  perform portal.clients_check_changes(p_changes, '{"title": "string", "stage": "string", "pricing": "string",
    "repo_url": "string|null", "preview_url": "string|null", "live_url": "string|null", "notes": "string|null"}');
  update portal.client_projects p
  set title = case when p_changes ? 'title' then trim(p_changes ->> 'title') else p.title end,
      stage = case when p_changes ? 'stage' then p_changes ->> 'stage' else p.stage end,
      pricing = case when p_changes ? 'pricing' then p_changes ->> 'pricing' else p.pricing end,
      repo_url = case when p_changes ? 'repo_url' then nullif(trim(p_changes ->> 'repo_url'), '') else p.repo_url end,
      preview_url = case when p_changes ? 'preview_url' then nullif(trim(p_changes ->> 'preview_url'), '') else p.preview_url end,
      live_url = case when p_changes ? 'live_url' then nullif(trim(p_changes ->> 'live_url'), '') else p.live_url end,
      notes = case when p_changes ? 'notes' then nullif(trim(p_changes ->> 'notes'), '') else p.notes end,
      updated_at = now()
  where p.gid = p_gid
  returning * into v;
  if not found then
    raise exception 'That project is not there any more.' using errcode = 'P0002';
  end if;
  return portal.client_project_json(v);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------

create function public.clients_add_milestone(
  p_project_gid bigint,
  p_title text,
  p_due_on date default null,
  p_amount_pence integer default null,
  p_access_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.client_milestones;
begin
  perform portal.require_clients_owner(p_access_hash);
  if not exists (select 1 from portal.client_projects p where p.gid = p_project_gid) then
    raise exception 'That project is not there any more.' using errcode = 'P0002';
  end if;
  insert into portal.client_milestones (project_gid, title, due_on, amount_pence)
  values (p_project_gid, trim(p_title), p_due_on, p_amount_pence)
  returning * into v;
  return portal.client_milestone_json(v);
end;
$function$;

-- Changes only the keys given: title, due_on, amount_pence, accepted_on and
-- paid_on (null clears any but the title).
create function public.clients_set_milestone(p_gid bigint, p_changes jsonb, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v portal.client_milestones;
begin
  perform portal.require_clients_owner(p_access_hash);
  perform portal.clients_check_changes(p_changes, '{"title": "string", "due_on": "string|null",
    "amount_pence": "number|null", "accepted_on": "string|null", "paid_on": "string|null"}');
  update portal.client_milestones m
  set title = case when p_changes ? 'title' then trim(p_changes ->> 'title') else m.title end,
      due_on = case when p_changes ? 'due_on' then (p_changes ->> 'due_on')::date else m.due_on end,
      amount_pence = case when p_changes ? 'amount_pence' then (p_changes ->> 'amount_pence')::integer else m.amount_pence end,
      accepted_on = case when p_changes ? 'accepted_on' then (p_changes ->> 'accepted_on')::date else m.accepted_on end,
      paid_on = case when p_changes ? 'paid_on' then (p_changes ->> 'paid_on')::date else m.paid_on end,
      updated_at = now()
  where m.gid = p_gid
  returning * into v;
  if not found then
    raise exception 'That milestone is not there any more.' using errcode = 'P0002';
  end if;
  return portal.client_milestone_json(v);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Removing
-- ---------------------------------------------------------------------------

-- Deletes a client (with its projects and milestones), a project (with its
-- milestones) or a milestone for good, and returns it, so the caller can say
-- what went.
create function public.clients_remove(p_kind text, p_gid bigint, p_access_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  c portal.clients;
  p portal.client_projects;
  m portal.client_milestones;
begin
  perform portal.require_clients_owner(p_access_hash);
  if p_kind = 'client' then
    delete from portal.clients x where x.gid = p_gid returning * into c;
    if found then
      return portal.client_json(c);
    end if;
  elsif p_kind = 'project' then
    delete from portal.client_projects x where x.gid = p_gid returning * into p;
    if found then
      return portal.client_project_json(p);
    end if;
  elsif p_kind = 'milestone' then
    delete from portal.client_milestones x where x.gid = p_gid returning * into m;
    if found then
      return portal.client_milestone_json(m);
    end if;
  else
    raise exception 'Remove a client, a project or a milestone.' using errcode = '22023';
  end if;
  raise exception 'That is not there any more.' using errcode = 'P0002';
end;
$function$;

-- Each function checks for the owner itself. anon too: connector calls have no
-- session and prove themselves with p_access_hash.
do $$
declare f text;
begin
  foreach f in array array[
    'clients_read(text)',
    'clients_add_client(text, text, text, text)',
    'clients_set_client(bigint, jsonb, text)',
    'clients_add_project(bigint, text, text, text)',
    'clients_set_project(bigint, jsonb, text)',
    'clients_add_milestone(bigint, text, date, integer, text)',
    'clients_set_milestone(bigint, jsonb, text)',
    'clients_remove(text, bigint, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
