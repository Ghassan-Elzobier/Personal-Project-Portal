-- Suite: portal access
--
-- Access lives in the `portal` schema, which the API roles cannot reach. The
-- portal RPCs in `public` are the only way in: anyone signed in may read their
-- own access, and only the owner may list, grant or revoke. The last owner
-- cannot be removed.

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
grant select on fx to authenticated;
insert into fx values
  ('owner', pg_temp.make_user('owner@test.local')),
  ('mentor', pg_temp.make_user('mentor@test.local')),
  ('outsider', pg_temp.make_user('outsider@test.local'));

-- The first owner, as the setup guide's SQL makes them.
insert into portal.members (account_id, role, display_name)
values ((select v from fx where k = 'owner'), 'owner', 'Owner');

-- ---------------------------------------------------------------------------
-- The portal schema is unreachable from the API
-- ---------------------------------------------------------------------------

select ok(
  not has_schema_privilege('anon', 'portal', 'usage')
  and not has_schema_privilege('authenticated', 'portal', 'usage'),
  'Given the portal schema, When API privileges are inspected, Then anon and authenticated cannot use it');

select ok(
  not has_table_privilege('authenticated', 'portal.members', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'portal.mentor_projects', 'select,insert,update,delete'),
  'Given the portal tables, When API privileges are inspected, Then authenticated has none');

select ok(
  (select relrowsecurity from pg_class where oid = 'portal.members'::regclass)
  and (select relrowsecurity from pg_class where oid = 'portal.mentor_projects'::regclass),
  'Given the portal tables, When RLS is inspected, Then it is enabled on both');

select ok(
  not has_function_privilege('anon', 'public.my_portal_access()', 'execute')
  and not has_function_privilege('anon', 'public.portal_members()', 'execute')
  and not has_function_privilege('anon', 'public.grant_portal_mentor(text, text, text[])', 'execute')
  and not has_function_privilege('anon', 'public.revoke_portal_member(uuid)', 'execute'),
  'Given the portal RPCs, When anon EXECUTE is inspected, Then none is callable without a session');

-- ---------------------------------------------------------------------------
-- Reading access
-- ---------------------------------------------------------------------------

select pg_temp.act_as((select v from fx where k = 'outsider'));

select is(
  (select count(*)::int from public.my_portal_access()),
  0,
  'Given an account with no access, When it reads its access, Then it gets no row');

select throws_ok(
  'select * from public.portal_members()',
  '42501',
  null,
  'Given an account with no access, When it lists members, Then it is refused');

select throws_ok(
  $$select public.grant_portal_mentor('outsider@test.local', 'Me', array['pmpp'])$$,
  '42501',
  null,
  'Given an account with no access, When it grants itself access, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'owner'));

select is(
  (select role from public.my_portal_access()),
  'owner',
  'Given the owner, When they read their access, Then the role is owner');

select is(
  (select projects from public.my_portal_access()),
  array['pmpp', 'axler', 'rendering', 'weekly-log'],
  'Given the owner, When they read their access, Then every project is readable');

-- ---------------------------------------------------------------------------
-- Granting and revoking
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.grant_portal_mentor('MENTOR@test.local ', 'Mentor', array['axler', 'weekly-log', 'axler'])$$,
  'Given the owner, When they grant a mentor by email, Then it succeeds regardless of case and duplicates');

select throws_ok(
  $$select public.grant_portal_mentor('mentor@test.local', 'Mentor', array['work-projects'])$$,
  '22023',
  null,
  'Given an unknown project key, When the owner grants it, Then it is rejected');

select throws_ok(
  $$select public.grant_portal_mentor('nobody@test.local', 'Nobody', array['pmpp'])$$,
  'P0002',
  null,
  'Given an email with no account, When the owner grants it, Then it is rejected');

select pg_temp.act_as((select v from fx where k = 'mentor'));

select is(
  (select projects from public.my_portal_access()),
  array['axler', 'weekly-log'],
  'Given a mentor, When they read their access, Then only their granted projects are listed');

select throws_ok(
  'select * from public.portal_members()',
  '42501',
  null,
  'Given a mentor, When they list members, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'owner'));

select throws_ok(
  format('select public.revoke_portal_member(%L)', (select v from fx where k = 'owner')),
  'P0001',
  null,
  'Given a single owner, When they revoke themselves, Then it is refused');

select public.revoke_portal_member((select v from fx where k = 'mentor'));
select pg_temp.act_as((select v from fx where k = 'mentor'));

select is(
  (select count(*)::int from public.my_portal_access()),
  0,
  'Given a revoked mentor, When they read their access, Then they have none');

select * from finish();
rollback;
