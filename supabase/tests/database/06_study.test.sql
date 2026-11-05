-- Suite: study tracking
--
-- Steps, exercises, reviews and benchmarks follow the same rules as tasks: the
-- owner changes everything, a mentor reads granted projects only, and everyone
-- else reads nothing. Loading a plan twice must never change existing work.

begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.make_user(p_email text)
returns uuid
language sql
as $$
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, now(), now())
  returning id;
$$;

create function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create temp table fx (k text primary key, v uuid) on commit drop;
create temp table t (k text primary key, v bigint) on commit drop;
grant select on fx to authenticated;
grant select, insert on t to authenticated;
insert into fx values
  ('owner', pg_temp.make_user('study-owner@test.local')),
  ('mentor', pg_temp.make_user('study-mentor@test.local')),
  ('outsider', pg_temp.make_user('study-outsider@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
values ((select v from fx where k = 'mentor'), 'axler');

select ok(
  not has_table_privilege('authenticated', 'portal.subtasks', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'portal.task_exercises', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.reviews', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'portal.benchmarks', 'select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid = 'portal.reviews'::regclass),
  'Given the study tables, When API privileges are inspected, Then the API roles have none and RLS is on');

select is(
  (select count(*)::int
   from pg_proc f
   join pg_namespace n on n.oid = f.pronamespace
   cross join lateral unnest(f.proargtypes::oid[]) a(x)
   join pg_type ty on ty.oid = a.x
   join pg_namespace tn on tn.oid = ty.typnamespace
   where n.nspname = 'public' and f.proname like 'tracker\_%' and tn.nspname = 'portal'),
  0,
  'Given the tracker RPCs, When argument types are inspected, Then none is in the portal schema');

select pg_temp.act_as((select v from fx where k = 'owner'));

select is(
  public.tracker_import_plan('axler', '[{"name": "Chapter 3", "tasks": [
    {"ref": "x-3B", "name": "3B Null Spaces", "notes": "n", "exercise_count": 5, "milestone": false,
     "subtasks": ["Read", "Recall"], "reviews": [{"kind": "result", "prompt": "Prove 3.21"}]}
  ]}]'::jsonb),
  1,
  'Given a plan, When it is loaded, Then its tasks are added');

insert into t select 'unit', (j ->> 'gid')::bigint from jsonb_array_elements(public.tracker_snapshot() -> 'tasks') j where j ->> 'ref' = 'x-3B';

select ok(
  not exists (select 1 from jsonb_array_elements(public.tracker_snapshot() -> 'sections') s where s ->> 'project' = 'axler' and s ->> 'name' = 'To do'),
  'Given an empty starter section, When a plan is loaded, Then the starter section goes');

select is(
  (public.tracker_task((select v from t where k = 'unit')) ->> 'exercise_count')::int,
  5,
  'Given a loaded unit, When it is read, Then it carries its exercise count');

-- Work on it, then load the plan again.
select public.tracker_update_task((select v from t where k = 'unit'), '{"name": "My edited name"}');
select is(
  public.tracker_import_plan('axler', '[{"name": "Chapter 3", "tasks": [
    {"ref": "x-3B", "name": "3B Null Spaces"},
    {"ref": "x-3C", "name": "3C Matrices"}
  ]}]'::jsonb),
  1,
  'Given a plan already loaded, When it is loaded again, Then only what is missing is added');
select is(
  public.tracker_task((select v from t where k = 'unit')) ->> 'name',
  'My edited name',
  'Given an edited unit, When its plan is loaded again, Then the edit survives');

select is(
  jsonb_array_length(public.tracker_study_snapshot() -> 'subtasks'),
  2,
  'Given a unit with steps, When the snapshot is read, Then its steps are there');

select public.tracker_set_subtask(
  (select (s ->> 'gid')::bigint from jsonb_array_elements(public.tracker_study_snapshot() -> 'subtasks') s limit 1),
  true);
select is(
  public.tracker_task((select v from t where k = 'unit')) ->> 'stage',
  'In progress',
  'Given a unit not started, When a step is ticked, Then it counts as in progress');

select public.tracker_set_exercise((select v from t where k = 'unit'), 1, 'solved');
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'kind' = 'exercise'),
  0,
  'Given a solved exercise, When reviews are read, Then none is added');

select public.tracker_set_exercise((select v from t where k = 'unit'), 2, 'stuck');
select is(
  (select r ->> 'due_on' from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'kind' = 'exercise'),
  (current_date + 1)::text,
  'Given a stuck exercise, When reviews are read, Then it is due back tomorrow');

select public.tracker_set_exercise((select v from t where k = 'unit'), 2, 'hint');
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'kind' = 'exercise'),
  1,
  'Given a stuck exercise marked again, When reviews are read, Then it is not duplicated');

select throws_ok(format($$select public.tracker_set_exercise(%s, 6, 'solved')$$, (select v from t where k = 'unit')), '22023', null,
  'Given a set of five exercises, When the sixth is marked, Then it is refused');

select public.tracker_set_exercise((select v from t where k = 'unit'), 1, null);
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_study_snapshot() -> 'exercises') e where (e ->> 'number')::int = 1),
  0,
  'Given a marked exercise, When it is cleared, Then its row goes');

select is(
  (select r ->> 'due_on' from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'prompt' = 'Prove 3.21'),
  null,
  'Given an unfinished unit, When its key result is read, Then it is not due yet');

select public.tracker_update_task((select v from t where k = 'unit'), '{"completed": true}');
select is(
  (select r ->> 'due_on' from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'prompt' = 'Prove 3.21'),
  (current_date + 1)::text,
  'Given a key result, When its unit is finished, Then it falls due the next day');

select public.tracker_rate_review(
  (select (r ->> 'gid')::bigint from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'prompt' = 'Prove 3.21'),
  'got', 7, null, true);
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'prompt' = 'Prove 3.21'),
  0,
  'Given a retired review, When reviews are read, Then it no longer appears');

select public.tracker_add_benchmark('rendering', null, 'Frame time', 16.5, 'ms', 'Spheres', 'Iris Xe', 'abc1234', '');
select is(
  (public.tracker_study_snapshot() -> 'benchmarks' -> 0 ->> 'value')::numeric,
  16.5,
  'Given a recorded result, When the snapshot is read, Then it is there');
select throws_ok($$select public.tracker_add_benchmark('rendering', null, 'x', 1, '', '', '', 'NOT-A-HASH', '')$$, '23514', null,
  'Given a bad commit hash, When a result is recorded, Then it is refused');

select public.tracker_set_due_dates(jsonb_build_array(jsonb_build_object('gid', (select v from t where k = 'unit'), 'due_on', '2030-01-02')));
select is(
  public.tracker_task((select v from t where k = 'unit')) ->> 'due_on',
  '2030-01-02',
  'Given new dates, When they are set in bulk, Then the task takes them');

-- Mentor: granted axler only.
select pg_temp.act_as((select v from fx where k = 'mentor'));

select ok(
  jsonb_array_length(public.tracker_study_snapshot() -> 'exercises') > 0,
  'Given a mentor granted axler, When the snapshot is read, Then its exercises are there');
select is(
  jsonb_array_length(public.tracker_study_snapshot() -> 'benchmarks'),
  0,
  'Given a mentor not granted rendering, When the snapshot is read, Then its results stay hidden');
select throws_ok($$select public.tracker_import_plan('axler', '[]'::jsonb)$$, '42501', null,
  'Given a mentor, When a plan is loaded, Then it is refused');
select throws_ok(format($$select public.tracker_set_exercise(%s, 1, 'solved')$$, (select v from t where k = 'unit')), '42501', null,
  'Given a mentor, When an exercise is marked, Then it is refused');
select throws_ok($$select public.tracker_add_benchmark('rendering', null, 'x', 1, '', '', '', '', '')$$, '42501', null,
  'Given a mentor, When a result is recorded, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'outsider'));
select is(
  public.tracker_study_snapshot(),
  jsonb_build_object('subtasks', '[]'::jsonb, 'exercises', '[]'::jsonb, 'reviews', '[]'::jsonb, 'benchmarks', '[]'::jsonb),
  'Given an account without access, When the snapshot is read, Then it is empty');

select * from finish();
rollback;
