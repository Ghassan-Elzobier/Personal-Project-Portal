-- Studying a book or building a project is more than a task list. This adds
-- what the Study page tracks, under the same rules as tasks: the owner changes
-- everything, mentors read the projects granted to them.
--
--   subtasks        the steps of a unit, like Asana's subtasks
--   task_exercises  one row for each textbook exercise you have touched
--   reviews         things to recall later, each with its next due day
--   benchmarks      measured results from the renderer, tied to a commit
--
-- tasks.ref is a stable key from the study plan in src/lib/study, so loading a
-- plan again only adds what is missing and never overwrites your edits.

alter table portal.tasks
  add column ref text check (ref is null or length(ref) between 1 and 40),
  add column exercise_count integer check (exercise_count is null or exercise_count between 0 and 1000);
create unique index tasks_project_ref_idx on portal.tasks (project, ref) where ref is not null;

create table portal.subtasks (
  gid      bigint generated always as identity primary key,
  task_gid bigint not null references portal.tasks (gid) on delete cascade,
  name     text not null check (length(trim(name)) between 1 and 300),
  done     boolean not null default false,
  position integer not null default 0
);
create index subtasks_task_idx on portal.subtasks (task_gid, position, gid);

create table portal.task_exercises (
  task_gid   bigint not null references portal.tasks (gid) on delete cascade,
  number     integer not null check (number between 1 and 1000),
  status     text not null check (status in ('solved', 'hint', 'stuck', 'skip')),
  updated_at timestamptz not null default now(),
  primary key (task_gid, number)
);

create table portal.reviews (
  gid              bigint generated always as identity primary key,
  task_gid         bigint not null references portal.tasks (gid) on delete cascade,
  kind             text not null check (kind in ('result', 'exercise', 'idea')),
  prompt           text not null check (length(trim(prompt)) between 1 and 500),
  step             integer not null default 0 check (step >= 0),
  -- Empty until the unit is finished: reviewing something unread is pointless.
  due_on           date,
  last_rating      text check (last_rating in ('got', 'shaky', 'missed')),
  last_reviewed_at timestamptz,
  retired_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (task_gid, prompt)
);
create index reviews_due_idx on portal.reviews (due_on) where retired_at is null;

create table portal.benchmarks (
  gid        bigint generated always as identity primary key,
  project    portal.project_key not null,
  task_gid   bigint references portal.tasks (gid) on delete set null,
  metric     text not null check (length(trim(metric)) between 1 and 80),
  value      numeric not null,
  unit       text not null default '' check (length(unit) <= 20),
  scene      text not null default '' check (length(scene) <= 120),
  gpu        text not null default '' check (length(gpu) <= 80),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),
  notes      text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index benchmarks_project_idx on portal.benchmarks (project, created_at);

alter table portal.subtasks enable row level security;
alter table portal.task_exercises enable row level security;
alter table portal.reviews enable row level security;
alter table portal.benchmarks enable row level security;
revoke all on table portal.subtasks, portal.task_exercises, portal.reviews, portal.benchmarks
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable through the API)
-- ---------------------------------------------------------------------------

create or replace function portal.task_json(t portal.tasks)
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
    'modified_at', t.modified_at,
    'ref', t.ref,
    'exercise_count', t.exercise_count
  );
$function$;

-- Working on a unit means it has started, without having to say so separately.
create function portal.mark_started(p_task bigint)
returns void
language sql
volatile
security definer
set search_path to ''
as $function$
  update portal.tasks
     set stage = case when stage = 'Not started' then 'In progress'::portal.task_stage else stage end,
         modified_at = now()
   where gid = p_task;
$function$;

revoke all on function portal.mark_started(bigint) from public, anon, authenticated;

-- Finishing a unit starts its reviews, however it was finished.
create function portal.start_reviews_on_finish()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.completed and not old.completed then
    update portal.reviews
       set due_on = current_date + 1
     where task_gid = new.gid and due_on is null and retired_at is null;
  end if;
  return new;
end;
$function$;

revoke all on function portal.start_reviews_on_finish() from public, anon, authenticated;

create trigger tasks_start_reviews
  after update of completed on portal.tasks
  for each row execute function portal.start_reviews_on_finish();

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create function public.tracker_study_snapshot(p_access_hash text default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with readable as (select * from portal.readable_projects(p_access_hash) k),
       tasks as (select t.gid, t.project from portal.tasks t where t.project in (select r.k from readable r))
  select jsonb_build_object(
    'subtasks', coalesce(
      (select jsonb_agg(jsonb_build_object('gid', s.gid::text, 'task_gid', s.task_gid::text, 'name', s.name, 'done', s.done) order by s.position, s.gid)
       from portal.subtasks s where s.task_gid in (select t.gid from tasks t)),
      '[]'::jsonb),
    'exercises', coalesce(
      (select jsonb_agg(jsonb_build_object('task_gid', e.task_gid::text, 'number', e.number, 'status', e.status, 'updated_at', e.updated_at))
       from portal.task_exercises e where e.task_gid in (select t.gid from tasks t)),
      '[]'::jsonb),
    'reviews', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'gid', v.gid::text, 'task_gid', v.task_gid::text, 'kind', v.kind, 'prompt', v.prompt, 'step', v.step,
                'due_on', v.due_on, 'last_rating', v.last_rating, 'last_reviewed_at', v.last_reviewed_at)
              order by v.due_on nulls last, v.gid)
       from portal.reviews v where v.retired_at is null and v.task_gid in (select t.gid from tasks t)),
      '[]'::jsonb),
    'benchmarks', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'gid', b.gid::text, 'project', b.project::text, 'task_gid', b.task_gid::text, 'metric', b.metric,
                'value', b.value, 'unit', b.unit, 'scene', b.scene, 'gpu', b.gpu, 'commit_sha', b.commit_sha,
                'notes', b.notes, 'created_at', b.created_at)
              order by b.created_at, b.gid)
       from portal.benchmarks b where b.project in (select r.k from readable r)),
      '[]'::jsonb)
  );
$function$;

-- ---------------------------------------------------------------------------
-- Changes (owner only)
-- ---------------------------------------------------------------------------

-- Adds whatever the plan has that the project lacks, matching tasks by ref and
-- sections by name. Your edits and progress are never touched. Returns how many
-- tasks were added. p_plan: [{name, tasks: [{ref, name, notes, exercise_count,
-- milestone, subtasks: [text], reviews: [{kind, prompt}]}]}]
create function public.tracker_import_plan(p_project text, p_plan jsonb, p_access_hash text default null)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_project portal.project_key := p_project::portal.project_key;
  v_section jsonb;
  v_task    jsonb;
  v_section_gid bigint;
  v_gid     bigint;
  v_added   integer := 0;
begin
  perform portal.require_task_owner(p_access_hash);

  for v_section in select * from jsonb_array_elements(p_plan) loop
    select s.gid into v_section_gid
    from portal.sections s
    where s.project = v_project and s.name = v_section ->> 'name'
    order by s.gid
    limit 1;

    if v_section_gid is null then
      insert into portal.sections (project, name, position)
      values (
        v_project,
        v_section ->> 'name',
        (select coalesce(max(s.position), 0) + 1 from portal.sections s where s.project = v_project))
      returning gid into v_section_gid;
    end if;

    for v_task in select * from jsonb_array_elements(v_section -> 'tasks') loop
      continue when exists (select 1 from portal.tasks t where t.project = v_project and t.ref = v_task ->> 'ref');

      insert into portal.tasks (project, section_gid, ref, name, notes, exercise_count, resource_subtype)
      values (
        v_project,
        v_section_gid,
        v_task ->> 'ref',
        v_task ->> 'name',
        coalesce(v_task ->> 'notes', ''),
        (v_task ->> 'exercise_count')::integer,
        case when (v_task ->> 'milestone')::boolean then 'milestone' else 'default_task' end)
      returning gid into v_gid;

      insert into portal.subtasks (task_gid, name, position)
      select v_gid, x.name, x.i
      from jsonb_array_elements_text(coalesce(v_task -> 'subtasks', '[]'::jsonb)) with ordinality as x(name, i);

      insert into portal.reviews (task_gid, kind, prompt)
      select v_gid, r ->> 'kind', r ->> 'prompt'
      from jsonb_array_elements(coalesce(v_task -> 'reviews', '[]'::jsonb)) as r;

      v_added := v_added + 1;
    end loop;
  end loop;

  -- The starter section has no purpose once the plan's sections exist.
  if v_added > 0 then
    delete from portal.sections s
     where s.project = v_project and s.name = 'To do'
       and not exists (select 1 from portal.tasks t where t.section_gid = s.gid);
  end if;

  return v_added;
end;
$function$;

-- p_status null clears the exercise. A stuck or hinted one comes back for review.
create function public.tracker_set_exercise(p_task bigint, p_number integer, p_status text, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_count integer;
  v_prompt text;
  v_due date;
begin
  perform portal.require_task_owner(p_access_hash);
  select t.exercise_count into v_count from portal.tasks t where t.gid = p_task;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  if p_number < 1 or (v_count is not null and p_number > v_count) then
    raise exception 'That exercise is not in this set.' using errcode = '22023';
  end if;

  if p_status is null then
    delete from portal.task_exercises e where e.task_gid = p_task and e.number = p_number;
    return;
  end if;

  insert into portal.task_exercises (task_gid, number, status)
  values (p_task, p_number, p_status)
  on conflict (task_gid, number) do update set status = excluded.status, updated_at = now();

  perform portal.mark_started(p_task);

  if p_status in ('stuck', 'hint') then
    v_prompt := 'Redo exercise ' || p_number || ' from a blank page.';
    v_due := current_date + case when p_status = 'stuck' then 1 else 2 end;
    insert into portal.reviews (task_gid, kind, prompt, due_on)
    values (p_task, 'exercise', v_prompt, v_due)
    on conflict (task_gid, prompt) do update
      set retired_at = null, step = 0, due_on = least(excluded.due_on, portal.reviews.due_on);
  end if;
end;
$function$;

create function public.tracker_set_exercise_count(p_task bigint, p_count integer, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  update portal.tasks set exercise_count = p_count, modified_at = now() where gid = p_task;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
end;
$function$;

create function public.tracker_add_subtask(p_task bigint, p_name text, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  insert into portal.subtasks (task_gid, name, position)
  values (p_task, trim(p_name), (select coalesce(max(s.position), 0) + 1 from portal.subtasks s where s.task_gid = p_task));
end;
$function$;

create function public.tracker_set_subtask(p_gid bigint, p_done boolean, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_task bigint;
begin
  perform portal.require_task_owner(p_access_hash);
  update portal.subtasks set done = p_done where gid = p_gid returning task_gid into v_task;
  if v_task is null then
    raise exception 'That step no longer exists.' using errcode = 'P0002';
  end if;
  if p_done then
    perform portal.mark_started(v_task);
  end if;
end;
$function$;

create function public.tracker_delete_subtask(p_gid bigint, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  delete from portal.subtasks where gid = p_gid;
end;
$function$;

create function public.tracker_add_review(p_task bigint, p_prompt text, p_due_on date, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  insert into portal.reviews (task_gid, kind, prompt, due_on)
  values (p_task, 'idea', trim(p_prompt), p_due_on)
  on conflict (task_gid, prompt) do update set retired_at = null, step = 0, due_on = excluded.due_on;
end;
$function$;

-- The schedule itself is worked out in src/lib/study/review.ts.
create function public.tracker_rate_review(
  p_gid bigint,
  p_rating text,
  p_step integer,
  p_due_on date,
  p_retire boolean,
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
  update portal.reviews
     set last_rating = p_rating,
         last_reviewed_at = now(),
         step = p_step,
         due_on = p_due_on,
         retired_at = case when p_retire then now() end
   where gid = p_gid;
  if not found then
    raise exception 'That review no longer exists.' using errcode = 'P0002';
  end if;
end;
$function$;

create function public.tracker_delete_review(p_gid bigint, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  delete from portal.reviews where gid = p_gid;
end;
$function$;

create function public.tracker_add_benchmark(
  p_project text,
  p_task bigint,
  p_metric text,
  p_value numeric,
  p_unit text,
  p_scene text,
  p_gpu text,
  p_commit text,
  p_notes text,
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
  insert into portal.benchmarks (project, task_gid, metric, value, unit, scene, gpu, commit_sha, notes)
  values (p_project::portal.project_key, p_task, trim(p_metric), p_value, trim(p_unit), trim(p_scene), trim(p_gpu), nullif(trim(p_commit), ''), trim(p_notes));
end;
$function$;

create function public.tracker_delete_benchmark(p_gid bigint, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  delete from portal.benchmarks where gid = p_gid;
end;
$function$;

-- p_items: [{gid, due_on}]. Sets plain due days in one go, for pacing a book.
create function public.tracker_set_due_dates(p_items jsonb, p_access_hash text default null)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
begin
  perform portal.require_task_owner(p_access_hash);
  update portal.tasks t
     set due_on = (i ->> 'due_on')::date, modified_at = now()
    from jsonb_array_elements(p_items) i
   where t.gid = (i ->> 'gid')::bigint and t.due_at is null;
end;
$function$;

do $grants$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.tracker_study_snapshot(text)',
    'public.tracker_import_plan(text, jsonb, text)',
    'public.tracker_set_exercise(bigint, integer, text, text)',
    'public.tracker_set_exercise_count(bigint, integer, text)',
    'public.tracker_add_subtask(bigint, text, text)',
    'public.tracker_set_subtask(bigint, boolean, text)',
    'public.tracker_delete_subtask(bigint, text)',
    'public.tracker_add_review(bigint, text, date, text)',
    'public.tracker_rate_review(bigint, text, integer, date, boolean, text)',
    'public.tracker_delete_review(bigint, text)',
    'public.tracker_add_benchmark(text, bigint, text, numeric, text, text, text, text, text, text)',
    'public.tracker_delete_benchmark(bigint, text)',
    'public.tracker_set_due_dates(jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
  end loop;
end;
$grants$;
