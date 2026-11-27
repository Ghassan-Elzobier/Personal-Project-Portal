-- Suite: editing a role's details (20261127142928_job_edit_details.sql)
--
-- "Add from the advert" saves a role in one tap, so the owner can fix its title,
-- employer, place, link and pay afterwards. Only a role added by hand can change, since
-- a feed rewrites its own roles on every read; nobody but the owner can change any.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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

create function pg_temp.posting(p_id text, p_title text)
returns jsonb
language sql
as $$
  select jsonb_build_object('source_job_id', p_id, 'title', p_title, 'company', 'Example Ltd', 'location', 'London', 'location_tier', 'london',
    'url', 'https://jobs.example/' || p_id, 'family', 'graphics', 'seniority', 'any', 'body', 'Requirements',
    'requirements', '[]'::jsonb, 'details', '{}'::jsonb, 'extract_version', 1);
$$;

-- The stored facts of a role, read as the owner reads them.
create function pg_temp.stored(p_gid bigint)
returns jsonb
language sql
as $$
  select r from jsonb_array_elements(public.tracker_job_postings()) r where (r ->> 'gid')::bigint = p_gid;
$$;

create temp table fx (k text primary key, v uuid) on commit drop;
create temp table t (k text primary key, v bigint) on commit drop;
grant select on fx to authenticated;
grant select, insert, update on t to authenticated;
insert into fx values
  ('owner', pg_temp.make_user('edit-owner@test.local')),
  ('mentor', pg_temp.make_user('edit-mentor@test.local')),
  ('outsider', pg_temp.make_user('edit-outsider@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');

select is(
  (select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.proname = 'tracker_edit_job_details'
     and (has_function_privilege('anon', f.oid, 'execute') or pg_get_function_arguments(f.oid) like '%p_access_hash%')),
  0,
  'Given the edit RPC, When its rights and arguments are inspected, Then anon may not run it and no connector token is accepted');

select pg_temp.act_as((select v from fx where k = 'owner'));
insert into t values ('hand', public.tracker_add_job_by_hand(pg_temp.posting('ignored', 'Graphics Programer')));
insert into t values ('source', public.tracker_add_job_source('ashby', 'example', 'Example Ltd'));
select public.tracker_save_job_read((select v from t where k = 'source'), true, null, array['feed-1'], jsonb_build_array(pg_temp.posting('feed-1', 'Rendering Engineer')));
insert into t values ('feed', (select (r ->> 'gid')::bigint from jsonb_array_elements(public.tracker_job_postings()) r where r ->> 'url' like '%/feed-1'));

-- The owner fixes a role they added

select lives_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"title": "  Graphics Programmer ", "company": "Example Studio", "location": "Manchester, UK", "location_tier": "uk", "url": "https://jobs.example/fixed", "salary": "£50,000 a year", "family": "graphics", "seniority": "mid"}'::jsonb) $$, (select v from t where k = 'hand')),
  'Given a role added by hand, When the owner edits its details, Then it saves');
select is(pg_temp.stored((select v from t where k = 'hand')) ->> 'title', 'Graphics Programmer', 'Then the title is fixed, trimmed');
select is(
  (select jsonb_build_object('company', r ->> 'company', 'location', r ->> 'location', 'tier', r ->> 'location_tier', 'url', r ->> 'url', 'salary', r ->> 'salary', 'seniority', r ->> 'seniority')
   from (select pg_temp.stored((select v from t where k = 'hand')) r) x),
  '{"company": "Example Studio", "location": "Manchester, UK", "tier": "uk", "url": "https://jobs.example/fixed", "salary": "£50,000 a year", "seniority": "mid"}'::jsonb,
  'Then the employer, place, tier, link, pay and seniority are as given');

select lives_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"salary": "", "url": ""}'::jsonb) $$, (select v from t where k = 'hand')),
  'Given a role with pay and a link, When both are cleared, Then it saves');
select is(
  (select jsonb_build_object('salary', r -> 'salary', 'url', r -> 'url', 'title', r ->> 'title') from (select pg_temp.stored((select v from t where k = 'hand')) r) x),
  '{"salary": null, "url": null, "title": "Graphics Programmer"}'::jsonb,
  'Then they are gone, and what was not sent stays as it was');

select throws_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"title": "  "}'::jsonb) $$, (select v from t where k = 'hand')),
  '23514', null, 'Given a blank title, When it is saved, Then it is refused');
select throws_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"url": "javascript:alert(1)"}'::jsonb) $$, (select v from t where k = 'hand')),
  '23514', null, 'Given a link that is not http, When it is saved, Then it is refused');

-- What may not change

select throws_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"title": "Changed"}'::jsonb) $$, (select v from t where k = 'feed')),
  '22023', 'Only a role you added yourself can be edited.', 'Given a role from a feed, When the owner edits it, Then it is refused, since the next read would undo it');
select throws_ok(
  $$ select public.tracker_edit_job_details(-1, '{"title": "Changed"}'::jsonb) $$,
  'P0002', null, 'Given a role that does not exist, When it is edited, Then it says so');

select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"title": "Mine now"}'::jsonb) $$, (select v from t where k = 'hand')),
  '42501', null, 'Given a mentor, When they edit a role, Then they are refused');

select pg_temp.act_as((select v from fx where k = 'outsider'));
select throws_ok(
  format($$ select public.tracker_edit_job_details(%s, '{"title": "Mine now"}'::jsonb) $$, (select v from t where k = 'hand')),
  '42501', null, 'Given someone with no access, When they edit a role, Then they are refused');

select * from finish();
rollback;
