-- Suite: the study pace
--
-- The owner's hours a week (and a later change of pace) are one saved row that
-- Today's weekly bar and the Sunday update count against. The owner reads and
-- sets it, from a browser session or through Claude's connector. A mentor,
-- someone signed in without access and a visitor can do neither.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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

-- From a known state: no pace, whatever this database held before.
delete from portal.study_pace;

create temp table fx (k text primary key, v uuid) on commit drop;
grant select on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('pace-owner@test.local')),
  ('mentor', pg_temp.make_user('pace-mentor@test.local')),
  ('outsider', pg_temp.make_user('pace-outsider@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
values ((select v from fx where k = 'mentor'), 'axler');
-- Claude's connector, connected by the owner: one live token and one that has run out.
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v from fx where k = 'owner'), 'c', repeat('a', 64), now() + interval '1 hour', repeat('b', 64), now() + interval '1 day'),
  ((select v from fx where k = 'owner'), 'c', repeat('c', 64), now() - interval '1 minute', repeat('d', 64), now() + interval '1 day');

select ok(
  not has_table_privilege('authenticated', 'portal.study_pace', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'portal.study_pace', 'select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid = 'portal.study_pace'::regclass),
  'Given the study pace table, When API privileges are inspected, Then the API roles have none and RLS is on');

-- The owner, signed in.
select pg_temp.act_as((select v from fx where k = 'owner'));

select is(public.get_study_pace(), null,
  'Given no pace has been set, When the owner reads it, Then there is none');

select lives_ok(
  $$select public.set_study_pace('{"hours_per_week": 37, "starts_on": "2026-11-16", "changes_on": "2026-12-01", "then_hours_per_week": 17.5}'::jsonb)$$,
  'Given the owner, When a pace with a later change is set, Then it is saved');

select is(
  public.get_study_pace(),
  '{"hours_per_week": 37.00, "starts_on": "2026-11-16", "changes_on": "2026-12-01", "then_hours_per_week": 17.50}'::jsonb,
  'Given a saved pace, When the owner reads it, Then it comes back as it was set');

select lives_ok(
  $$select public.set_study_pace('{"hours_per_week": 20, "starts_on": "2026-11-23"}'::jsonb)$$,
  'Given a saved pace, When the owner sets another with no change, Then it is saved');

select is(
  public.get_study_pace(),
  '{"hours_per_week": 20.00, "starts_on": "2026-11-23", "changes_on": null, "then_hours_per_week": null}'::jsonb,
  'Given a second pace, When the owner reads it, Then it has replaced the first, change and all');

-- What a pace must be.
select throws_ok($$select public.set_study_pace('{"hours_per_week": 0, "starts_on": "2026-11-16"}'::jsonb)$$, '22023', null,
  'Given a pace of no hours, When it is set, Then it is refused');
select throws_ok($$select public.set_study_pace('{"hours_per_week": 101, "starts_on": "2026-11-16"}'::jsonb)$$, '22023', null,
  'Given a pace of more than 100 hours a week, When it is set, Then it is refused');
select throws_ok($$select public.set_study_pace('{"hours_per_week": 20}'::jsonb)$$, '22023', null,
  'Given a pace with no start day, When it is set, Then it is refused');
select throws_ok(
  $$select public.set_study_pace('{"hours_per_week": 20, "starts_on": "2026-11-16", "changes_on": "2026-12-01"}'::jsonb)$$, '22023', null,
  'Given a change of pace with a day and no hours, When it is set, Then it is refused');
select throws_ok(
  $$select public.set_study_pace('{"hours_per_week": 20, "starts_on": "2026-11-16", "changes_on": "2026-11-16", "then_hours_per_week": 10}'::jsonb)$$,
  '22023', null,
  'Given a change of pace on the day the pace starts, When it is set, Then it is refused');
select throws_ok($$select public.set_study_pace('"twenty"'::jsonb)$$, '22023', null,
  'Given a pace that is not an object, When it is set, Then it is refused');

select is(
  public.get_study_pace() ->> 'hours_per_week', '20.00',
  'Given refused paces, When the owner reads the pace, Then the last good one still stands');

-- The owner, through Claude's connector.
select pg_temp.act_as_anon();

select is(
  public.get_study_pace(repeat('a', 64)) ->> 'starts_on', '2026-11-23',
  'Given the owner''s live connector token, When the pace is read, Then it is returned');

select lives_ok(
  $$select public.set_study_pace('{"hours_per_week": 12.5, "starts_on": "2026-11-16"}'::jsonb, repeat('a', 64))$$,
  'Given the owner''s live connector token, When a pace is set, Then it is saved');

select throws_ok($$select public.get_study_pace(repeat('c', 64))$$, '42501', null,
  'Given a connector token that has run out, When the pace is read, Then it is refused');

-- A visitor, with no session and no token.
select throws_ok($$select public.get_study_pace()$$, '42501', null,
  'Given a visitor, When the pace is read, Then it is refused');
select throws_ok($$select public.set_study_pace('{"hours_per_week": 5, "starts_on": "2026-11-16"}'::jsonb)$$, '42501', null,
  'Given a visitor, When a pace is set, Then it is refused');

-- A mentor, and someone signed in with no access.
select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok($$select public.get_study_pace()$$, '42501', null,
  'Given a mentor, When the pace is read, Then it is refused');
select throws_ok($$select public.set_study_pace('{"hours_per_week": 5, "starts_on": "2026-11-16"}'::jsonb)$$, '42501', null,
  'Given a mentor, When a pace is set, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'outsider'));
select throws_ok($$select public.set_study_pace(null)$$, '42501', null,
  'Given someone signed in with no access, When the pace is forgotten, Then it is refused');

-- Forgetting the pace.
select pg_temp.act_as((select v from fx where k = 'owner'));
select public.set_study_pace(null);
select is(public.get_study_pace(), null,
  'Given the pace the connector set, When the owner forgets it, Then there is none again');

select * from finish();
rollback;
