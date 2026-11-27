-- Suite: Claude's reading of adverts (20261127153351_job_claude_reading.sql)
--
-- A role from a careers page arrives with a title and a link only. When the owner has
-- the portal read its advert, the text and the requirements read from it are kept on
-- the role. Each check hands Claude the adverts the rules read too weakly to judge,
-- and a feed's next read leaves Claude's reading alone while the advert is unchanged.
-- Nobody but the owner can do any of it, and an empty advert is refused.

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

-- The stored facts of a role, read as the owner reads them.
create function pg_temp.stored(p_gid bigint)
returns jsonb
language sql
as $$
  select r from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = p_gid;
$$;

create function pg_temp.feed_posting(p_id text, p_body text, p_requirements jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object('source_job_id', p_id, 'title', 'Rendering Engineer ' || p_id, 'company', 'Example Ltd', 'location', 'London',
    'location_tier', 'london', 'url', 'https://jobs.example/' || p_id, 'family', 'graphics', 'seniority', 'any', 'body', p_body,
    'requirements', p_requirements, 'details', '{}'::jsonb, 'extract_version', 1);
$$;

create temp table prose (v text) on commit drop;
grant select on prose to authenticated;
insert into prose values (repeat('You will build our renderer with artists and engineers in London. ', 8));

create temp table fx (k text primary key, v uuid) on commit drop;
create temp table t (k text primary key, v bigint) on commit drop;
grant select on fx to authenticated;
grant select, insert, update on t to authenticated;
insert into fx values
  ('owner', pg_temp.make_user('advert-owner@test.local')),
  ('mentor', pg_temp.make_user('advert-mentor@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');

select is(
  (select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.proname in ('tracker_set_job_advert', 'tracker_job_weak_adverts')
     and (has_function_privilege('anon', f.oid, 'execute') or pg_get_function_arguments(f.oid) like '%p_access_hash%')),
  0,
  'Given the new job RPCs, When their rights and arguments are inspected, Then anon may not run them and no connector token is accepted');

-- A role from a careers page: a title and a link, no advert.
select pg_temp.act_as((select v from fx where k = 'owner'));
insert into t values ('source', public.tracker_add_job_source('link', 'careers-example', 'Example Ltd', 'https://careers.example/jobs'));
select public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['https://careers.example/jobs/1'],
  jsonb_build_array(jsonb_build_object('source_job_id', 'https://careers.example/jobs/1', 'title', 'Graphics Engineer', 'company', 'Example Ltd',
    'location', 'London', 'location_tier', 'london', 'url', 'https://careers.example/jobs/1', 'family', 'graphics', 'seniority', 'any', 'body', '',
    'requirements', '[]'::jsonb, 'details', '{}'::jsonb, 'extract_version', 0)));
insert into t values ('role', (select (r ->> 'gid')::bigint from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'title' = 'Graphics Engineer' and r ->> 'company' = 'Example Ltd'));

select is((pg_temp.stored((select v from t where k = 'role')) ->> 'has_body')::boolean, false, 'Given a role from a careers page, Then it has no advert yet');

select lives_ok(
  format($$ select public.tracker_set_job_advert(%s, '{"body": "You have shipped a renderer in Vulkan.", "family": "graphics", "seniority": "mid", "requirements": [{"skill": "vulkan", "level": "required", "quote": "You have shipped a renderer in Vulkan.", "group": 1}], "details": {"readBy": "claude"}, "extract_version": 1000}'::jsonb) $$, (select v from t where k = 'role')),
  'Given its advert, read, When the owner keeps it, Then it saves');
select is(
  (select jsonb_build_object('has_body', r -> 'has_body', 'skill', r -> 'requirements' -> 0 ->> 'skill', 'read_by', r -> 'details' ->> 'readBy', 'seniority', r ->> 'seniority')
   from (select pg_temp.stored((select v from t where k = 'role')) r) x),
  '{"has_body": true, "skill": "vulkan", "read_by": "claude", "seniority": "mid"}'::jsonb,
  'Then the role has its advert, its requirements and who read them');
select is(
  (select p.extract_version from portal.job_postings p where p.gid = (select v from t where k = 'role')),
  1000,
  'Then its reading is marked as Claude''s, so the rules never read over it');

select throws_ok(
  format($$ select public.tracker_set_job_advert(%s, '{"body": "   "}'::jsonb) $$, (select v from t where k = 'role')),
  '22023', 'There is no advert text to keep.', 'Given an empty advert, When it is kept, Then it is refused');
select throws_ok(
  $$ select public.tracker_set_job_advert(-1, '{"body": "Text"}'::jsonb) $$,
  'P0002', null, 'Given a role that does not exist, When its advert is kept, Then it says so');

select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok(
  format($$ select public.tracker_set_job_advert(%s, '{"body": "Text"}'::jsonb) $$, (select v from t where k = 'role')),
  '42501', null, 'Given a mentor, When they keep an advert, Then they are refused');

-- Which adverts are too weakly read to judge, and what a feed's next read leaves alone
select pg_temp.act_as((select v from fx where k = 'owner'));
insert into t values ('feed', public.tracker_add_job_source('ashby', 'example-weak', 'Example Ltd'));


select public.tracker_save_job_read((select v from t where k = 'feed'), true, null, array['weak', 'clear'], jsonb_build_array(
  pg_temp.feed_posting('weak', (select v from prose), '[{"skill": "cpp", "level": "unstated", "quote": "renderer", "group": 1}]'::jsonb),
  pg_temp.feed_posting('clear', (select v from prose), '[{"skill": "cpp", "level": "required", "quote": "C++", "group": 1}, {"skill": "vulkan", "level": "required", "quote": "Vulkan", "group": 2}, {"skill": "cuda", "level": "preferred", "quote": "CUDA", "group": 3}]'::jsonb)));
insert into t values ('weak', (select (r ->> 'gid')::bigint from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'title' = 'Rendering Engineer weak'));

select is(
  (select array_agg(r ->> 'title' order by r ->> 'title') from jsonb_array_elements(public.tracker_job_weak_adverts(50)) r where r ->> 'title' like 'Rendering Engineer %'),
  array['Rendering Engineer weak'],
  'Given an advert read from its duties and one read clearly, When the weak ones are asked for, Then only the first comes back');
select ok(
  (select (r ->> 'body') = (select v from prose) and r ? 'requirements' and r ? 'family' from jsonb_array_elements(public.tracker_job_weak_adverts(50)) r where r ->> 'title' = 'Rendering Engineer weak'),
  'Then it comes with its advert and its reading, for Claude to read');

select public.tracker_set_job_extractions(jsonb_build_array(jsonb_build_object('gid', (select v from t where k = 'weak')::text, 'family', 'graphics', 'seniority', 'any',
  'requirements', '[{"skill": "vulkan", "level": "required", "quote": "Claude read this", "group": 1}]'::jsonb, 'details', '{"readBy": "claude"}'::jsonb, 'extract_version', 1000)));
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_job_weak_adverts(50)) r where r ->> 'title' = 'Rendering Engineer weak'),
  0,
  'Given Claude has read it, When the weak ones are asked for again, Then it does not come back');

select public.tracker_save_job_read((select v from t where k = 'feed'), true, null, array['weak', 'clear'], jsonb_build_array(
  pg_temp.feed_posting('weak', (select v from prose), '[{"skill": "cpp", "level": "unstated", "quote": "renderer", "group": 1}]'::jsonb)));
select is(
  (select jsonb_build_object('skill', r -> 'requirements' -> 0 ->> 'skill', 'read_by', r -> 'details' ->> 'readBy')
   from (select pg_temp.stored((select v from t where k = 'weak')) r) x),
  '{"skill": "vulkan", "read_by": "claude"}'::jsonb,
  'Given the feed sends the same advert again, Then Claude''s reading stands');

select public.tracker_save_job_read((select v from t where k = 'feed'), true, null, array['weak', 'clear'], jsonb_build_array(
  pg_temp.feed_posting('weak', (select v from prose) || ' Now hiring two.', '[{"skill": "cpp", "level": "unstated", "quote": "renderer", "group": 1}]'::jsonb)));
select is(
  (select jsonb_build_object('skill', r -> 'requirements' -> 0 ->> 'skill', 'read_by', r -> 'details' ->> 'readBy')
   from (select pg_temp.stored((select v from t where k = 'weak')) r) x),
  '{"skill": "cpp", "read_by": null}'::jsonb,
  'Given the feed sends changed text, Then the rules read it afresh');
select is(
  (select count(*)::int from jsonb_array_elements(public.tracker_job_weak_adverts(50)) r where r ->> 'title' = 'Rendering Engineer weak'),
  1,
  'Then it is weak again, for Claude to read at the next check');

select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok($$ select public.tracker_job_weak_adverts(8) $$, '42501', null, 'Given a mentor, When they ask for the weak adverts, Then they are refused');

select * from finish();
rollback;
