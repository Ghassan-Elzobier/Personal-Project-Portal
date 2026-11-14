-- Suite: error tracking
--
-- Portal members (from a session or a live connector token) record errors;
-- anon, strangers and expired tokens cannot, and nobody reads the table
-- through the API. Occurrences of one bug share a row. A flood of new bugs is
-- capped. The triage sees new groups and filed ones that happened again, and
-- nothing it was told to ignore.

begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

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

-- A report with made-up content; only the fingerprint and release vary.
create function pg_temp.report(p_fingerprint text, p_release text default 'abcdef1', p_access_hash text default null)
returns text
language sql
as $$
  select public.report_error(
    p_fingerprint, 'browser', 'TypeError', 'Cannot read properties of undefined (reading ''title'')',
    '/life', 'uncaught', 'at MealCard (/_next/static/chunks/a.js:1:2)', p_release, p_access_hash
  );
$$;

create temp table fx (k text primary key, v uuid) on commit drop;
grant select on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('errors-owner@test.local')),
  ('mentor', pg_temp.make_user('errors-mentor@test.local')),
  ('stranger', pg_temp.make_user('errors-stranger@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v from fx where k = 'owner'), 'test', encode(sha256('errors-live'), 'hex'), now() + interval '1 hour', encode(sha256('errors-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v from fx where k = 'owner'), 'test', encode(sha256('errors-expired'), 'hex'), now() - interval '1 minute', encode(sha256('errors-expired-refresh'), 'hex'), now() + interval '1 day');

-- Start from an empty table, whatever earlier runs left in the local stack.
delete from portal.error_groups;

-- The owner, in the browser
select pg_temp.act_as((select v from fx where k = 'owner'));

select is(pg_temp.report('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'new', 'the first occurrence of a bug makes a new group');
select is(pg_temp.report('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'abcdef2'), 'seen', 'the next occurrence joins it');
select throws_ok(
  $$ select pg_temp.report('not-a-fingerprint') $$,
  '23514', null, 'a malformed fingerprint is refused'
);
select throws_ok(
  $$ select public.report_error('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'elsewhere', 'Error', 'x', '/life', 'render', '', null) $$,
  '23514', null, 'an unknown source is refused'
);
select throws_ok(
  $$ select count(*) from portal.error_groups $$,
  '42501', null, 'even the owner cannot read the table through the API'
);
select throws_ok(
  $$ select * from portal.errors_to_triage() $$,
  '42501', null, 'nor run the triage'
);

-- A mentor
select pg_temp.act_as((select v from fx where k = 'mentor'));
select is(pg_temp.report('cccccccccccccccccccccccccccccccc'), 'new', 'a mentor''s errors are recorded too');

-- Someone signed in without access
select pg_temp.act_as((select v from fx where k = 'stranger'));
select throws_ok(
  $$ select pg_temp.report('dddddddddddddddddddddddddddddddd') $$,
  '42501', null, 'an account without access cannot report'
);

-- The connector, with no session
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select is(
  pg_temp.report('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'abcdef1', encode(sha256('errors-live'), 'hex')),
  'new',
  'a live connector token can report'
);
select throws_ok(
  $$ select pg_temp.report('ffffffffffffffffffffffffffffffff', 'abcdef1', encode(sha256('errors-expired'), 'hex')) $$,
  '42501', null, 'an expired token cannot'
);
select throws_ok(
  $$ select pg_temp.report('ffffffffffffffffffffffffffffffff') $$,
  '42501', null, 'nor can anon without a token'
);

-- What was stored
reset role;
select results_eq(
  $$ select occurrences, release, status from portal.error_groups where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' $$,
  $$ values (2, 'abcdef2'::text, 'new'::text) $$,
  'a group counts its occurrences and keeps the latest release'
);

-- The triage
select is(
  (select count(*)::int from portal.errors_to_triage()),
  3,
  'the triage sees every new group'
);
select lives_ok(
  $$ select portal.record_triage('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'filed', 7, true) $$,
  'the triage records the issue it filed, handed to Claude'
);
select lives_ok(
  $$ select portal.record_triage('cccccccccccccccccccccccccccccccc', 'ignored', 8) $$,
  'and a group whose issue was closed as not planned'
);
select is(
  (select array_agg(fingerprint) from portal.errors_to_triage()),
  array['eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
  'groups it has dealt with drop out'
);
update portal.error_groups set synced_at = now() - interval '1 minute'
where fingerprint in ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccccccccccc');
select pg_temp.act_as((select v from fx where k = 'owner'));
select is(pg_temp.report('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'seen', 'a filed bug happens again');
select is(pg_temp.report('cccccccccccccccccccccccccccccccc'), 'seen', 'and so does an ignored one');
reset role;
select is(
  (select array_agg(fingerprint order by fingerprint) from portal.errors_to_triage()),
  array['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
  'the filed bug is news again; the ignored one stays quiet'
);
select is(
  (select issue_number from portal.error_groups where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  7,
  'it keeps its issue'
);
select is(
  (select count(*)::int from portal.error_groups where autofix_at is not null),
  1,
  'only the group handed to Claude counts toward the daily fixes'
);
select throws_ok(
  $$ select portal.record_triage('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'new', null) $$,
  'P0001', null, 'the triage cannot put a group back to new'
);

-- A flood of distinct errors
insert into portal.error_groups (fingerprint, source, name, message, route, context)
select lpad(to_hex(n), 32, '0'), 'server', 'Error', 'flood', '/', 'render'
from generate_series(1, 25) n;
select pg_temp.act_as((select v from fx where k = 'owner'));
select is(
  pg_temp.report('99999999999999999999999999999999'),
  'dropped',
  'after 25 new groups in a day, more new ones are dropped'
);

select * from finish();
rollback;
