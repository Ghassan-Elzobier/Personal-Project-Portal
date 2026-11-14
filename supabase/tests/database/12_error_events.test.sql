-- Suite: error occurrences
--
-- record_error keeps each occurrence of a bug with its device, release, stack
-- and breadcrumbs, and decides itself who hit it. Members (session or live
-- connector token) can record; strangers and anon cannot; nobody reads the
-- tables through the API. Each bug keeps its last 30 occurrences and 90 days of
-- history, daily counts add up, and a dropped occurrence leaves nothing behind.

begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

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

-- One made-up occurrence; the fingerprint, device and breadcrumbs vary.
create function pg_temp.record(
  p_fingerprint text,
  p_device text default 'phone',
  p_breadcrumbs jsonb default '[{"at":"2026-11-14T09:30:00.000Z","kind":"navigation","text":"load → /life"}]',
  p_access_hash text default null
)
returns text
language sql
as $$
  select public.record_error(
    p_fingerprint, 'browser', 'TypeError', 'Cannot read properties of undefined (reading ''title'')',
    '/life', 'uncaught', 'at MealCard (src/app/life/meal-card.tsx:42:7)', 'abcdef1',
    'Chrome 131', 'Android 15', p_device, '412x915', p_breadcrumbs, p_access_hash
  );
$$;

create temp table fx (k text primary key, v uuid) on commit drop;
grant select on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('events-owner@test.local')),
  ('mentor', pg_temp.make_user('events-mentor@test.local')),
  ('stranger', pg_temp.make_user('events-stranger@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v from fx where k = 'owner'), 'test', encode(sha256('events-live'), 'hex'), now() + interval '1 hour', encode(sha256('events-live-refresh'), 'hex'), now() + interval '1 day');

-- Start from empty tables, whatever earlier runs left in the local stack.
delete from portal.error_groups;

-- The owner, in the browser
select pg_temp.act_as((select v from fx where k = 'owner'));
select is(pg_temp.record('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'new', 'the first occurrence starts a group');
select is(pg_temp.record('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'desktop'), 'seen', 'the next one joins it');
select throws_ok(
  $$ select count(*) from portal.error_events $$,
  '42501', null, 'occurrences cannot be read through the API'
);
select throws_ok(
  $$ select count(*) from portal.error_daily $$,
  '42501', null, 'nor can the daily counts'
);
select throws_ok(
  $$ select pg_temp.record('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'toaster') $$,
  '23514', null, 'an unknown kind of device is refused'
);
select throws_ok(
  $$ select pg_temp.record('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'phone', '{"not": "a list"}') $$,
  '23514', null, 'breadcrumbs must be a list'
);
select throws_ok(
  $$ select pg_temp.record('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'phone',
       (select jsonb_agg(jsonb_build_object('at', '2026-11-14T09:30:00.000Z', 'kind', 'navigation', 'text', 'load → /'))
        from generate_series(1, 31))) $$,
  '23514', null, 'and at most thirty of them'
);

-- A mentor
select pg_temp.act_as((select v from fx where k = 'mentor'));
select is(pg_temp.record('cccccccccccccccccccccccccccccccc'), 'new', 'a mentor can record');

-- Someone signed in without access
select pg_temp.act_as((select v from fx where k = 'stranger'));
select throws_ok(
  $$ select pg_temp.record('dddddddddddddddddddddddddddddddd') $$,
  '42501', null, 'an account without access cannot'
);

-- The connector, with no session
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select is(
  pg_temp.record('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'unknown', '[]', encode(sha256('events-live'), 'hex')),
  'new',
  'a live connector token can record'
);
select throws_ok(
  $$ select pg_temp.record('ffffffffffffffffffffffffffffffff') $$,
  '42501', null, 'anon without a token cannot'
);

-- What was stored
reset role;
select results_eq(
  $$ select device, reporter, browser, os, viewport from portal.error_events
     where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' order by id $$,
  $$ values ('phone'::text, 'owner'::text, 'Chrome 131'::text, 'Android 15'::text, '412x915'::text),
            ('desktop', 'owner', 'Chrome 131', 'Android 15', '412x915') $$,
  'each occurrence keeps its own device'
);
select is(
  (select reporter from portal.error_events where fingerprint = 'cccccccccccccccccccccccccccccccc'),
  'mentor',
  'the database decides who hit it: a mentor'
);
select is(
  (select reporter from portal.error_events where fingerprint = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
  'connector',
  'or the connector'
);
select is(
  (select occurrences from portal.error_daily where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  2,
  'the day counts both occurrences'
);
select is(
  (select occurrences from portal.error_groups where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  2,
  'and so does the group'
);
select is(
  (select device from portal.latest_error_event('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'desktop',
  'the latest occurrence is the newest one'
);
select is(
  (select breadcrumbs -> 0 ->> 'text' from portal.latest_error_event('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'load → /life',
  'with its breadcrumbs'
);
select is_empty(
  $$ select * from portal.latest_error_event('99999999999999999999999999999999') $$,
  'a bug with no occurrences has no latest one'
);

-- Keeping it small
insert into portal.error_events (fingerprint, occurred_at, reporter)
values ('cccccccccccccccccccccccccccccccc', now() - interval '100 days', 'owner');
insert into portal.error_daily (fingerprint, day, occurrences)
values ('cccccccccccccccccccccccccccccccc', (now() at time zone 'utc')::date - 100, 4);
select pg_temp.act_as((select v from fx where k = 'owner'));
do $$ begin perform pg_temp.record('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') from generate_series(1, 33); end $$;
reset role;
select is(
  (select count(*)::int from portal.error_events where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  30,
  'a bug keeps its last thirty occurrences'
);
select is(
  (select occurrences from portal.error_groups where fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  35,
  'while the group still counts them all'
);
select is(
  (select count(*)::int from portal.error_events where occurred_at < now() - interval '90 days'),
  0,
  'occurrences older than ninety days go'
);
select is(
  (select count(*)::int from portal.error_daily where day < (now() at time zone 'utc')::date - 90),
  0,
  'and so do old daily counts'
);

-- A flood of distinct errors
insert into portal.error_groups (fingerprint, source, name, message, route, context)
select lpad(to_hex(n), 32, '0'), 'server', 'Error', 'flood', '/', 'render'
from generate_series(1, 25) n;
select pg_temp.act_as((select v from fx where k = 'owner'));
select is(pg_temp.record('12121212121212121212121212121212'), 'dropped', 'past the daily cap, a new bug is dropped');
reset role;
select is_empty(
  $$ select * from portal.error_events where fingerprint = '12121212121212121212121212121212' $$,
  'and leaves no occurrence behind'
);

select * from finish();
rollback;
