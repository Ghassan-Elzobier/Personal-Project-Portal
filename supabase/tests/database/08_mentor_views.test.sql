-- Suite: what mentors see beyond their projects
--
-- The job hunt reaches a mentor only when the owner shares it with them, and even
-- then without anything the owner wrote: notes, next actions, ratings, advert text.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

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
create temp table t (k text primary key, v jsonb) on commit drop;
grant select on fx to authenticated;
grant select, insert on t to authenticated;
insert into fx values
  ('owner', pg_temp.make_user('share-owner@test.local')),
  ('shared', pg_temp.make_user('share-mentor@test.local')),
  ('unshared', pg_temp.make_user('share-other@test.local')),
  ('outsider', pg_temp.make_user('share-outsider@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'shared'), 'mentor', 'Shared'),
  ((select v from fx where k = 'unshared'), 'mentor', 'Unshared');

-- The owner's job hunt, with things only the owner should ever read.
select pg_temp.act_as((select v from fx where k = 'owner'));
select public.tracker_add_job_by_hand(
  '{"title": "Rendering Engineer", "company": "Example", "location": "London", "location_tier": "london", "family": "graphics", "body": "SECRET ADVERT TEXT", "salary": "£99,999", "requirements": [{"skill": "vulkan", "level": "required", "quote": "SECRET QUOTE", "group": 1}]}'::jsonb,
  '{"stage": "applied", "interest": 3, "notes": "SECRET NOTE", "next_action": "SECRET ACTION", "legacy_rating": 9}'::jsonb
);
select public.tracker_add_skill_evidence('vulkan', 4, 'Public renderer', 'https://example.test/renderer');
select public.tracker_add_skill_evidence('python', 2, 'SECRET PRIVATE PROJECT', 'https://example.test/private');

select is(public.my_mentor_shares(), array['job-hunt'], 'Given the owner, When shares are read, Then the owner has everything');

select throws_ok($$ select public.set_mentor_share((select v from fx where k = 'owner'), 'job-hunt', true) $$, 'P0002', null, 'Given the owner account, When it is shared with, Then it is refused as not a mentor');
select lives_ok($$ select public.set_mentor_share((select v from fx where k = 'shared'), 'job-hunt', true) $$, 'Given a mentor, When the owner shares the job hunt, Then it is saved');
select throws_ok($$ select public.set_mentor_share((select v from fx where k = 'shared'), 'everything', true) $$, '23514', null, 'Given a share that does not exist, When it is saved, Then it is refused');
select is(
  (select s.shares from public.portal_mentor_shares() s where s.account_id = (select v from fx where k = 'shared')),
  array['job-hunt'],
  'Given a shared mentor, When the owner lists access, Then the share is shown');

-- A mentor it is shared with
select pg_temp.act_as((select v from fx where k = 'shared'));
select is(public.my_mentor_shares(), array['job-hunt'], 'Given a shared mentor, When shares are read, Then the job hunt is there');
insert into t values ('source', public.tracker_mentor_job_source());
select is(jsonb_array_length((select v from t) -> 'postings'), 1, 'Given a shared mentor, When the job hunt is read, Then the roles are there');
select ok(
  (select v::text from t) not like '%SECRET%',
  'Given a shared mentor, When the job hunt is read, Then no note, next action, advert text, quote or private evidence is in it');
select ok(
  not ((select v from t) -> 'postings' -> 0 ?| array['notes', 'next_action', 'legacy_rating', 'body', 'salary', 'url']),
  'Given a shared mentor, When the job hunt is read, Then those fields are not even present');
select is(
  (select e ->> 'url' from jsonb_array_elements((select v from t) -> 'evidence') e where e ->> 'skill' = 'python'),
  null,
  'Given evidence that is not public, When a mentor reads it, Then its link is left out');
select is(
  (select e ->> 'url' from jsonb_array_elements((select v from t) -> 'evidence') e where e ->> 'skill' = 'vulkan'),
  'https://example.test/renderer',
  'Given public evidence, When a mentor reads it, Then its link is shown');
select throws_ok($$ select public.tracker_job_postings() $$, '42501', null, 'Given a shared mentor, When the owner''s own job data is read, Then it is refused');
select throws_ok($$ select public.set_mentor_share((select v from fx where k = 'unshared'), 'job-hunt', true) $$, '42501', null, 'Given a mentor, When they try to share with someone, Then they are refused');

-- A mentor it is not shared with, and someone with no access
select pg_temp.act_as((select v from fx where k = 'unshared'));
select throws_ok($$ select public.tracker_mentor_job_source() $$, '42501', null, 'Given a mentor without the share, When the job hunt is read, Then they are refused');
select pg_temp.act_as((select v from fx where k = 'outsider'));
select throws_ok($$ select public.tracker_mentor_job_source() $$, '42501', null, 'Given someone with no access, When the job hunt is read, Then they are refused');

reset role;
select is(
  (select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.proname in ('my_mentor_shares', 'portal_mentor_shares', 'set_mentor_share', 'tracker_mentor_job_source')
     and has_function_privilege('anon', f.oid, 'execute')),
  0,
  'Given the sharing functions, When anonymous rights are inspected, Then the connector''s role has no route in');

select * from finish();
rollback;
