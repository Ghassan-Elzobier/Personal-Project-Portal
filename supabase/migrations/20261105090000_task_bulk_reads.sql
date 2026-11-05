-- One call instead of many. A page used to read each project's tasks, updates
-- and comments separately, so a single page view could take dozens of round
-- trips to the database. These RPCs return everything the caller may read at
-- once, under the same access rules as the per-item RPCs: owners read every
-- project, mentors read those granted to them, and anyone else reads nothing.

create function portal.readable_projects(p_access_hash text)
returns setof portal.project_key
language sql
stable
security definer
set search_path to ''
as $function$
  with caller as (select portal.task_caller(p_access_hash) as id)
  select k
  from caller, unnest(enum_range(null::portal.project_key)) k
  where portal.is_owner(caller.id)
  union
  select p.project
  from caller
  join portal.mentor_projects p on p.account_id = caller.id;
$function$;

revoke all on function portal.readable_projects(text) from public, anon, authenticated;

-- Every readable project's sections, tasks and status updates. An account with
-- no access gets empty lists, the same answer as having nothing shared.
create function public.tracker_snapshot(p_access_hash text default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with readable as (select * from portal.readable_projects(p_access_hash) k)
  select jsonb_build_object(
    'projects', coalesce((select jsonb_agg(r.k::text) from readable r), '[]'::jsonb),
    'sections', coalesce(
      (select jsonb_agg(jsonb_build_object('gid', s.gid::text, 'project', s.project::text, 'name', s.name) order by s.position, s.gid)
       from portal.sections s where s.project in (select r.k from readable r)),
      '[]'::jsonb),
    'tasks', coalesce(
      (select jsonb_agg(portal.task_json(t) order by t.gid)
       from portal.tasks t where t.project in (select r.k from readable r)),
      '[]'::jsonb),
    'updates', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'gid', u.gid::text, 'project', u.project::text, 'title', u.title, 'text', u.text,
                'status_type', u.status_type, 'created_at', u.created_at)
              order by u.created_at desc, u.gid desc)
       from portal.status_updates u where u.project in (select r.k from readable r)),
      '[]'::jsonb)
  );
$function$;

-- Comments since a moment across every readable project, for hours per week.
create function public.tracker_comments_since(p_since timestamptz, p_access_hash text default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'task_gid', c.task_gid::text, 'project', t.project::text, 'text', c.text, 'created_at', c.created_at)
      order by c.created_at),
    '[]'::jsonb)
  from portal.task_comments c
  join portal.tasks t on t.gid = c.task_gid
  where c.created_at >= p_since
    and t.project in (select k from portal.readable_projects(p_access_hash) k);
$function$;

-- Adds several tasks in one go, in order, for pasting a list of chapters.
create function public.tracker_create_tasks(
  p_project text,
  p_names text[],
  p_section_gid bigint default null,
  p_access_hash text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  perform portal.require_task_owner(p_access_hash);
  if p_section_gid is not null
     and not exists (select 1 from portal.sections s
                     where s.gid = p_section_gid and s.project = p_project::portal.project_key) then
    raise exception 'That section is not in this project.' using errcode = '22023';
  end if;
  insert into portal.tasks (project, section_gid, name)
  select p_project::portal.project_key, p_section_gid, trim(n)
  from unnest(p_names) with ordinality as x(n, i)
  where length(trim(n)) > 0
  order by i;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.tracker_snapshot(text) from public;
revoke all on function public.tracker_comments_since(timestamptz, text) from public;
revoke all on function public.tracker_create_tasks(text, text[], bigint, text) from public;
grant execute on function public.tracker_snapshot(text) to anon, authenticated, service_role;
grant execute on function public.tracker_comments_since(timestamptz, text) to anon, authenticated, service_role;
grant execute on function public.tracker_create_tasks(text, text[], bigint, text) to anon, authenticated, service_role;
