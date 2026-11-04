-- Suite: native tasks
--
-- The tracker_* RPCs are the only way to the task tables. The owner reads and
-- changes everything, a mentor reads granted projects and changes nothing,
-- anyone else gets nothing, and a live connector token acts for the owner.

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

create function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create temp table fx (k text primary key, v uuid) on commit drop;
create temp table gids (k text primary key, v bigint) on commit drop;
grant select on fx to authenticated, anon;
grant select, insert, update on gids to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('owner@test.local')),
  ('mentor', pg_temp.make_user('mentor@test.local')),
  ('outsider', pg_temp.make_user('outsider@test.local'));

insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
values ((select v from fx where k = 'mentor'), 'axler');

insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v from fx where k = 'owner'), 'c', repeat('a', 64), now() + interval '1 hour', repeat('b', 64), now() + interval '1 day'),
  ((select v from fx where k = 'owner'), 'c', repeat('c', 64), now() - interval '1 minute', repeat('d', 64), now() + interval '1 day');

select ok(
  not has_table_privilege('authenticated', 'portal.tasks', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'portal.tasks', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.task_comments', 'select')
  and not has_table_privilege('authenticated', 'portal.status_updates', 'select')
  and not has_table_privilege('authenticated', 'portal.sections', 'select')
  and (select relrowsecurity from pg_class where oid = 'portal.tasks'::regclass),
  'Given the task tables, When API privileges are inspected, Then the API roles have none and RLS is on');

select is(
  (select count(*)::int from portal.sections where name = 'To do'),
  4,
  'Given the migration, When sections are counted, Then each project starts with one');

select is(
  (select count(*)::int
   from pg_proc f
   join pg_namespace n on n.oid = f.pronamespace
   cross join lateral unnest(f.proargtypes::oid[]) a(t)
   join pg_type ty on ty.oid = a.t
   join pg_namespace tn on tn.oid = ty.typnamespace
   where n.nspname = 'public' and f.proname like 'tracker\_%' and tn.nspname = 'portal'),
  0,
  'Given the tracker RPCs, When argument types are inspected, Then none is in the portal schema the API cannot use');

-- Owner
select pg_temp.act_as((select v from fx where k = 'owner'));

insert into gids select 'axler', ((public.tracker_create_task('axler', '  Chapter 3  ', null, '2026-11-10')) ->> 'gid')::bigint;
insert into gids select 'pmpp', ((public.tracker_create_task('pmpp', 'CUDA intro')) ->> 'gid')::bigint;

select is(
  public.tracker_task((select v from gids where k = 'axler')) ->> 'name',
  'Chapter 3',
  'Given the owner, When a task is created, Then its name is trimmed and it reads back');

select is(
  public.tracker_task((select v from gids where k = 'axler')) ->> 'stage',
  'Not started',
  'Given a new task, When it is read, Then it starts Not started');

select throws_ok(
  $$select public.tracker_create_task('axler', 'x', (select s.gid from public.tracker_sections('pmpp') j, lateral (select (j -> 0 ->> 'gid')::bigint gid) s))$$,
  '22023', null,
  'Given a section of another project, When a task is created in it, Then it is refused');

select lives_ok(
  format($$select public.tracker_update_task(%s, '{"completed": true, "stage": "Done", "hours": 2.5}')$$, (select v from gids where k = 'axler')),
  'Given the owner, When a task is completed, Then the change is accepted');

select isnt(
  public.tracker_task((select v from gids where k = 'axler')) ->> 'completed_at',
  null,
  'Given a completed task, When it is read, Then completed_at is set');

select is(
  jsonb_array_length(public.tracker_tasks('axler', now() + interval '1 minute')),
  0,
  'Given a task completed earlier, When filtered by a later completed_since, Then it is left out');

select lives_ok(
  format($$select public.tracker_update_task(%s, '{"completed": false, "stage": "In progress"}')$$, (select v from gids where k = 'axler')),
  'Given a completed task, When it is reopened, Then the change is accepted');

select is(
  public.tracker_task((select v from gids where k = 'axler')) ->> 'completed_at',
  null,
  'Given a reopened task, When it is read, Then completed_at is cleared');

select lives_ok(
  format($$select public.tracker_update_task(%s, '{"start_at": "2026-11-10T09:00:00Z", "due_at": "2026-11-10T10:00:00Z"}')$$, (select v from gids where k = 'axler')),
  'Given a task, When a time slot is set, Then the change is accepted');

select is(
  public.tracker_task((select v from gids where k = 'axler')) ->> 'due_on',
  null,
  'Given a task with a due time, When it is read, Then the plain due date is replaced');

select lives_ok(
  format($$select public.tracker_update_task(%s, '{"start_at": null, "due_on": "2026-11-11"}')$$, (select v from gids where k = 'axler')),
  'Given a scheduled task, When it is unscheduled, Then the change is accepted');

select ok(
  (public.tracker_task((select v from gids where k = 'axler')) ->> 'due_at') is null
  and (public.tracker_task((select v from gids where k = 'axler')) ->> 'start_at') is null
  and public.tracker_task((select v from gids where k = 'axler')) ->> 'due_on' = '2026-11-11',
  'Given an unscheduled task, When it is read, Then it has a due date and no times');

select public.tracker_add_comment((select v from gids where k = 'axler'), 'Session log · 1 h');
select public.tracker_add_status_update('axler', 'Week of 2 Nov', 'All on track here.', 'on_track');

select is(
  jsonb_array_length(public.tracker_comments((select v from gids where k = 'axler'))),
  1,
  'Given a comment, When comments are listed, Then it is there');

-- Mentor
select pg_temp.act_as((select v from fx where k = 'mentor'));

select is(
  jsonb_array_length(public.tracker_status_updates('axler')),
  1,
  'Given a mentor granted axler, When its updates are read, Then they are returned');

select is(
  public.tracker_task((select v from gids where k = 'axler')) ->> 'name',
  'Chapter 3',
  'Given a mentor granted axler, When its task is read, Then it is returned');

select throws_ok($$select public.tracker_tasks('pmpp')$$, '42501', null,
  'Given a mentor not granted pmpp, When its tasks are read, Then it is refused');

select throws_ok(format($$select public.tracker_task(%s)$$, (select v from gids where k = 'pmpp')), '42501', null,
  'Given a mentor not granted pmpp, When its task is read by id, Then it is refused');

select throws_ok(format($$select public.tracker_update_task(%s, '{"name": "hacked"}')$$, (select v from gids where k = 'axler')), '42501', null,
  'Given a mentor, When a granted task is changed, Then it is refused');

select throws_ok($$select public.tracker_tasks('no-such-project')$$, '42501', null,
  'Given a mentor, When an unknown project is read, Then it looks the same as an unshared one');

-- Outsider and signed-out callers
select pg_temp.act_as((select v from fx where k = 'outsider'));

select throws_ok($$select public.tracker_tasks('axler')$$, '42501', null,
  'Given an account without access, When tasks are read, Then it is refused');

select pg_temp.act_as_anon();

select throws_ok($$select public.tracker_tasks('axler')$$, '42501', null,
  'Given no session and no token, When tasks are read, Then it is refused');

select is(
  jsonb_array_length(public.tracker_status_updates('axler', null, repeat('a', 64))),
  1,
  'Given no session and a live connector token, When updates are read, Then they are returned');

select throws_ok($$select public.tracker_tasks('axler', null, null, repeat('c', 64))$$, '42501', null,
  'Given an expired connector token, When tasks are read, Then it is refused');

select * from finish();
rollback;
