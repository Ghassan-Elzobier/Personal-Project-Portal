-- Suite: the job tracker
--
-- Employers, ratings and applications are the owner's alone: a mentor reads none of
-- it and the connector has no route in. Reading a feed must never touch what the
-- owner decided, and a role only closes on good evidence.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

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

create function pg_temp.posting(p_id text, p_title text default 'Rendering Engineer', p_body text default 'Requirements')
returns jsonb
language sql
as $$
  select jsonb_build_object('source_job_id', p_id, 'title', p_title, 'company', 'Example', 'location', 'London', 'location_tier', 'london',
    'url', 'https://jobs.example/' || p_id, 'family', 'graphics', 'seniority', 'any', 'body', p_body,
    'requirements', '[{"skill": "vulkan", "level": "required", "quote": "Vulkan", "group": 1}]'::jsonb, 'details', '{}'::jsonb, 'extract_version', 1);
$$;

create temp table fx (k text primary key, v uuid) on commit drop;
create temp table t (k text primary key, v bigint) on commit drop;
grant select on fx to authenticated;
grant select, insert, update on t to authenticated;
insert into fx values
  ('owner', pg_temp.make_user('jobs-owner@test.local')),
  ('mentor', pg_temp.make_user('jobs-mentor@test.local')),
  ('outsider', pg_temp.make_user('jobs-outsider@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
values ((select v from fx where k = 'mentor'), 'rendering');

-- Who may do what

select ok(
  not has_table_privilege('authenticated', 'portal.job_sources', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.job_postings', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.job_tracking', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.job_events', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.skill_evidence', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'portal.job_postings', 'select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid = 'portal.job_postings'::regclass),
  'Given the job tables, When API privileges are inspected, Then the API roles have none and RLS is on');

select is(
  (select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.proname in ('tracker_job_sources', 'tracker_add_job_source', 'tracker_update_job_source', 'tracker_job_known_ids', 'tracker_save_job_read', 'tracker_job_postings', 'tracker_job_detail', 'tracker_job_stale_extractions', 'tracker_set_job_extractions', 'tracker_set_job_tracking', 'tracker_add_job_by_hand', 'tracker_skill_evidence', 'tracker_add_skill_evidence', 'tracker_delete_skill_evidence')
     and has_function_privilege('anon', f.oid, 'execute')),
  0,
  'Given the job RPCs, When anonymous rights are inspected, Then the connector''s role has no route in');

select is(
  (select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.proname like 'tracker\_%job%' and pg_get_function_arguments(f.oid) like '%p_access_hash%'),
  0,
  'Given the job RPCs, When their arguments are inspected, Then none accepts a connector token');

select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok($$ select public.tracker_job_postings() $$, '42501', null, 'Given a mentor, When they read roles, Then they are refused');
select throws_ok($$ select public.tracker_job_sources() $$, '42501', null, 'Given a mentor, When they read sources, Then they are refused');
select throws_ok($$ select public.tracker_skill_evidence() $$, '42501', null, 'Given a mentor, When they read evidence, Then they are refused');

select pg_temp.act_as((select v from fx where k = 'outsider'));
select throws_ok($$ select public.tracker_job_postings() $$, '42501', null, 'Given someone with no access, When they read roles, Then they are refused');
select throws_ok($$ select public.tracker_add_job_source('ashby', 'x', 'X') $$, '42501', null, 'Given someone with no access, When they add a source, Then they are refused');

-- Reading a feed

select pg_temp.act_as((select v from fx where k = 'owner'));
insert into t values ('source', public.tracker_add_job_source('ashby', 'example', 'Example'));

select throws_ok($$ select public.tracker_add_job_source('manual', 'x', 'X') $$, '22023', null, 'Given the hand-added source, When someone adds it directly, Then it is refused');
select throws_ok($$ select public.tracker_add_job_source('ashby', '../evil', 'X') $$, '23514', null, 'Given a board name with a path in it, When it is added, Then it is refused');

select is(
  public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a', 'b'], jsonb_build_array(pg_temp.posting('a'), pg_temp.posting('b'))),
  '{"added": 2, "closed": 0}'::jsonb,
  'Given a first read, When it is saved, Then both roles are added');

insert into t values ('a', (select (r ->> 'gid')::bigint from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'url' like '%/a'));
insert into t values ('b', (select (r ->> 'gid')::bigint from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'url' like '%/b'));

select is(
  public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a', 'b'], jsonb_build_array(pg_temp.posting('a', 'Rendering Engineer II'), pg_temp.posting('b'))),
  '{"added": 0, "closed": 0}'::jsonb,
  'Given the same roles again, When they are saved, Then nothing is added twice');

select is(
  (select r ->> 'title' from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'a')),
  'Rendering Engineer II',
  'Given a changed title, When it is read again, Then the new title is stored');

select public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a', 'b'], jsonb_build_array(pg_temp.posting('a', 'Rendering Engineer II', '')));
select is(
  public.tracker_job_detail((select v from t where k = 'a')) ->> 'body',
  'Requirements',
  'Given a feed that lists a role without its text, When it is read, Then the text on file survives');

select public.tracker_set_job_tracking((select v from t where k = 'a'), '{"interest": 3, "stage": "applied", "next_action": "Chase", "notes": "Mine"}'::jsonb);
select public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a', 'b'], jsonb_build_array(pg_temp.posting('a', 'New title')));
select is(
  (select array[r ->> 'interest', r ->> 'stage', r ->> 'next_action', r ->> 'notes'] from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'a')),
  array['3', 'applied', 'Chase', 'Mine'],
  'Given what you decided about a role, When a feed is read, Then it is untouched');

-- When a role closes

select public.tracker_save_job_read((select v from t where k = 'source'), false, 'The feed answered 500.', null, '[]'::jsonb);
select public.tracker_save_job_read((select v from t where k = 'source'), false, 'The feed answered 500.', null, '[]'::jsonb);
select public.tracker_save_job_read((select v from t where k = 'source'), false, 'The feed answered 500.', null, '[]'::jsonb);
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'closed_at' is not null),
  0,
  'Given a feed that keeps failing, When reads fail, Then no role closes');
select is(
  (select r ->> 'last_error' from jsonb_array_elements(public.tracker_job_sources()) r where (r ->> 'gid')::bigint = (select v from t where k = 'source')),
  'The feed answered 500.',
  'Given a failed read, When sources are listed, Then the problem is shown');

select public.tracker_save_job_read((select v from t where k = 'source'), true, null, '{}', '[]'::jsonb);
select public.tracker_save_job_read((select v from t where k = 'source'), true, null, '{}', '[]'::jsonb);
select public.tracker_save_job_read((select v from t where k = 'source'), true, null, null, '[]'::jsonb);
select public.tracker_save_job_read((select v from t where k = 'source'), true, null, null, '[]'::jsonb);
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'closed_at' is not null),
  0,
  'Given an empty or partial read, When it is saved, Then no role closes');

select is(
  public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a'], '[]'::jsonb),
  '{"added": 0, "closed": 0}'::jsonb,
  'Given a role missing from one good read, When it is saved, Then it stays open');
select is(
  public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a'], '[]'::jsonb),
  '{"added": 0, "closed": 1}'::jsonb,
  'Given a role missing from two good reads in a row, When it is saved, Then it closes');

select public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['a', 'b'], '[]'::jsonb);
select is(
  (select r ->> 'closed_at' from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'b')),
  null,
  'Given a closed role that comes back, When it is read, Then it reopens');

-- Your side of a role

select is(
  (select jsonb_agg(e ->> 'stage') from jsonb_array_elements(public.tracker_job_detail((select v from t where k = 'a')) -> 'events') e),
  '["applied"]'::jsonb,
  'Given a stage change, When history is read, Then it is recorded');
select is(
  (select r ->> 'applied_on' from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'a')),
  current_date::text,
  'Given a role marked applied, When it is read, Then the day is kept');

select public.tracker_set_job_tracking((select v from t where k = 'a'), '{"notes": "Changed"}'::jsonb);
select is(
  (select array[r ->> 'interest', r ->> 'notes'] from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'a')),
  array['3', 'Changed'],
  'Given a change to one field, When it is saved, Then the others stay');
select public.tracker_set_job_tracking((select v from t where k = 'a'), '{"interest": null}'::jsonb);
select is(
  (select r ->> 'interest' from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'a')),
  null,
  'Given a field set to null, When it is saved, Then it clears');
select throws_ok(format($$ select public.tracker_set_job_tracking(%s, '{"stage": "hired-by-magic"}'::jsonb) $$, (select v from t where k = 'a')), '23514', null, 'Given a stage that does not exist, When it is saved, Then it is refused');

insert into t values ('hand', public.tracker_add_job_by_hand(pg_temp.posting('ignored', 'Graphics Programmer'), '{"legacy_rating": 8}'::jsonb));
select is(
  (select array[r ->> 'stage', r ->> 'legacy_rating', r ->> 'source_kind'] from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = (select v from t where k = 'hand')),
  array['saved', '8', 'manual'],
  'Given a role added by hand, When it is read, Then it is saved with its old rating');
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_job_sources()) r where r ->> 'kind' = 'manual'),
  0,
  'Given the hand-added source, When sources are listed, Then it is not shown as an employer');
select throws_ok($$ select public.tracker_add_job_by_hand('{"title": "T", "company": "C", "url": "javascript:alert(1)"}'::jsonb) $$, '23514', null, 'Given a link that is not http, When a role is added, Then it is refused');

-- Evidence

select public.tracker_add_skill_evidence('vulkan', 4, 'A public renderer', 'https://example.test/r');
select is(
  (select e ->> 'note' from jsonb_array_elements(public.tracker_skill_evidence()) e where e ->> 'skill' = 'vulkan'),
  'A public renderer',
  'Given evidence you added, When it is read, Then it is there');

select * from finish();
rollback;
