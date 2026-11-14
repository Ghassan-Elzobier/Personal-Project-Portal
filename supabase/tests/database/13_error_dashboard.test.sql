-- Suite: the errors page
--
-- Only the owner lists errors, reads one, and ignores or restores it; mentors
-- and anon get nothing. Restoring brings back the status the bug had (new, or
-- filed when it has an issue), and the triage then brings the issue in line:
-- it sees an ignored bug whose issue should close, and a restored one whose
-- issue should reopen. Test errors are never handed to the triage.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

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
grant select on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('dashboard-owner@test.local')),
  ('mentor', pg_temp.make_user('dashboard-mentor@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');

-- Made-up bugs: one filed with an issue, one new, one ignored, one test error.
delete from portal.error_groups;
insert into portal.error_groups (fingerprint, source, name, message, route, context, status, issue_number, synced_at, last_seen) values
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'server', 'TypeError', 'filed one', '/life', 'render', 'filed', 7, now(), now() - interval '1 hour'),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'browser', 'Error', 'new one', '/week', 'uncaught', 'new', null, null, now()),
  ('cccccccccccccccccccccccccccccccc', 'connector', 'Error', 'ignored one', '/api/mcp', 'tool log_meal', 'ignored', null, now(), now() - interval '2 hours'),
  ('dddddddddddddddddddddddddddddddd', 'server', 'Error', 'Test error from the errors page', '/errors', 'test', 'new', null, null, now() - interval '3 hours');
insert into portal.error_daily (fingerprint, day, occurrences) values
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-15', 2),
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-16', 3);
insert into portal.error_events (fingerprint, reporter, browser, os, device, viewport, breadcrumbs) values
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'owner', 'Chrome 131', 'Android 15', 'phone', '412x915',
   '[{"at":"2026-11-16T09:00:00.000Z","kind":"navigation","text":"load → /life"}]');

-- The owner
select pg_temp.act_as((select v from fx where k = 'owner'));
select is(
  (select jsonb_agg(e ->> 'fingerprint') from jsonb_array_elements(public.error_list('open') -> 'errors') e),
  '["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "dddddddddddddddddddddddddddddddd"]'::jsonb,
  'the open list has new and filed bugs, most recent first'
);
select is(
  (public.error_list('ignored') -> 'errors' -> 0 ->> 'fingerprint'),
  'cccccccccccccccccccccccccccccccc',
  'the ignored list has the ignored one'
);
select is(
  (select (l ->> 'open')::int * 10 + (l ->> 'ignored')::int from public.error_list('open') l),
  31,
  'the list counts both'
);
select is(
  (public.error_list('open') -> 'errors' -> 1 -> 'daily' -> 1 ->> 'occurrences')::int,
  3,
  'each bug comes with its daily counts'
);
select throws_ok(
  $$ select public.error_list('everything') $$,
  '22023', null, 'only open or ignored can be listed'
);
select is(
  (public.error_detail('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') -> 'events' -> 0 ->> 'browser'),
  'Chrome 131',
  'a bug comes with its occurrences'
);
select is(public.error_detail('99999999999999999999999999999999'), null, 'an unknown bug is nothing');

-- Ignoring and restoring
select is(public.set_error_ignored('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true), 'ignored', 'the owner ignores a filed bug');
select is(public.set_error_ignored('cccccccccccccccccccccccccccccccc', false), 'new', 'and restores one with no issue to new');
select throws_ok(
  $$ select public.set_error_ignored('99999999999999999999999999999999', true) $$,
  'P0002', null, 'an unknown bug cannot be ignored'
);

-- What the triage sees now
reset role;
select is(
  (select array_agg(fingerprint order by fingerprint) from portal.errors_to_triage()),
  array['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccc'],
  'the triage sees the ignored bug whose issue should close, the new ones, and never the test error'
);
select portal.record_triage('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ignored', null);
select pg_temp.act_as((select v from fx where k = 'owner'));
select is(public.set_error_ignored('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', false), 'filed', 'restoring a bug with an issue makes it filed');
reset role;
select ok(
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' in (select fingerprint from portal.errors_to_triage()),
  'and the triage sees it, to reopen the issue'
);

-- A mentor
select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok($$ select public.error_list('open') $$, '42501', null, 'a mentor cannot list errors');
select throws_ok(
  $$ select public.error_detail('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  '42501', null, 'nor read one'
);
select throws_ok(
  $$ select public.set_error_ignored('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true) $$,
  '42501', null, 'nor ignore one'
);

-- Signed out
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select throws_ok($$ select public.error_list('open') $$, '42501', null, 'anon cannot call the errors page''s functions');

select * from finish();
rollback;
