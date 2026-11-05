-- Suite: bulk task reads
--
-- tracker_snapshot and tracker_comments_since return many projects at once, so
-- they must apply the same rules as the per-project RPCs: the owner reads
-- everything, a mentor reads only granted projects, and nobody else reads
-- anything. A live connector token reads as the owner.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

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
grant select on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('bulk-owner@test.local')),
  ('mentor', pg_temp.make_user('bulk-mentor@test.local')),
  ('outsider', pg_temp.make_user('bulk-outsider@test.local'));

insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
values ((select v from fx where k = 'mentor'), 'axler');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v from fx where k = 'owner'), 'c', repeat('1', 64), now() + interval '1 hour', repeat('2', 64), now() + interval '1 day'),
  ((select v from fx where k = 'owner'), 'c', repeat('3', 64), now() - interval '1 minute', repeat('4', 64), now() + interval '1 day');

with a as (insert into portal.tasks (project, name) values ('axler', 'Axler task') returning gid),
     p as (insert into portal.tasks (project, name) values ('pmpp', 'PMPP task') returning gid)
insert into portal.task_comments (task_gid, text)
select gid, 'Session log · 1 h' from a union all select gid, 'Session log · 2 h' from p;
insert into portal.status_updates (project, title, text, status_type) values
  ('axler', 'A', 'Axler update here', 'on_track'),
  ('pmpp', 'P', 'PMPP update here', 'on_track');

select pg_temp.act_as((select v from fx where k = 'owner'));

select is(jsonb_array_length(public.tracker_snapshot() -> 'projects'), 4,
  'Given the owner, When the snapshot is read, Then every project is included');
select is(jsonb_array_length(public.tracker_snapshot() -> 'tasks'), 2,
  'Given the owner, When the snapshot is read, Then tasks from every project are included');
select is(jsonb_array_length(public.tracker_comments_since(now() - interval '1 hour')), 2,
  'Given the owner, When recent comments are read, Then those from every project are included');

select is(public.tracker_create_tasks('axler', array['One', '  ', ' Two ']), 2,
  'Given the owner, When a pasted list is added, Then blank lines are skipped');
select is(
  (select jsonb_agg(t ->> 'name' order by (t ->> 'gid')::bigint) from jsonb_array_elements(public.tracker_snapshot() -> 'tasks') t where t ->> 'name' in ('One', 'Two')),
  '["One", "Two"]'::jsonb,
  'Given a pasted list, When it is read back, Then names are trimmed and in order');
select throws_ok(
  $$select public.tracker_create_tasks('axler', array['x'], (select (s ->> 'gid')::bigint from jsonb_array_elements(public.tracker_snapshot() -> 'sections') s where s ->> 'project' = 'pmpp'))$$,
  '22023', null,
  'Given a section of another project, When a list is added to it, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'mentor'));

select is(public.tracker_snapshot() -> 'projects', '["axler"]'::jsonb,
  'Given a mentor, When the snapshot is read, Then only granted projects are listed');
select ok(
  not exists (select 1 from jsonb_array_elements(public.tracker_snapshot() -> 'tasks') t where t ->> 'project' <> 'axler')
  and not exists (select 1 from jsonb_array_elements(public.tracker_snapshot() -> 'updates') u where u ->> 'project' <> 'axler')
  and not exists (select 1 from jsonb_array_elements(public.tracker_snapshot() -> 'sections') s where s ->> 'project' <> 'axler'),
  'Given a mentor, When the snapshot is read, Then nothing from other projects leaks');
select is(public.tracker_comments_since(now() - interval '1 hour') -> 0 ->> 'project', 'axler',
  'Given a mentor, When recent comments are read, Then the first is from the granted project');
select is(jsonb_array_length(public.tracker_comments_since(now() - interval '1 hour')), 1,
  'Given a mentor, When recent comments are read, Then only granted projects count');
select throws_ok($$select public.tracker_create_tasks('axler', array['hacked'])$$, '42501', null,
  'Given a mentor, When a list is added, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'outsider'));
select is(public.tracker_snapshot(), jsonb_build_object('projects', '[]'::jsonb, 'sections', '[]'::jsonb, 'tasks', '[]'::jsonb, 'updates', '[]'::jsonb),
  'Given an account without access, When the snapshot is read, Then it is empty');

select pg_temp.act_as_anon();
select is(jsonb_array_length(public.tracker_snapshot() -> 'tasks'), 0,
  'Given no session and no token, When the snapshot is read, Then it is empty');
select is(jsonb_array_length(public.tracker_snapshot(repeat('1', 64)) -> 'projects'), 4,
  'Given a live connector token, When the snapshot is read, Then it reads as the owner');
select is(jsonb_array_length(public.tracker_comments_since(now() - interval '1 hour', repeat('3', 64))), 0,
  'Given an expired connector token, When comments are read, Then there are none');

select * from finish();
rollback;
