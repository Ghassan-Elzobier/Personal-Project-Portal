-- Suite: Google Calendar connection
--
-- Only the owner may store, read or clear the encrypted refresh token, and
-- the table is unreachable from the API.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

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
  ('mentor', pg_temp.make_user('mentor@test.local'));

insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');

select ok(
  not has_table_privilege('authenticated', 'portal.google_connections', 'select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid = 'portal.google_connections'::regclass),
  'Given the Google table, When API privileges are inspected, Then authenticated has none and RLS is on');

select ok(
  not has_function_privilege('anon', 'public.google_connection()', 'execute')
  and not has_function_privilege('anon', 'public.set_google_connection(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.clear_google_connection()', 'execute'),
  'Given the Google RPCs, When anon EXECUTE is inspected, Then none is callable without a session');

select pg_temp.act_as((select v from fx where k = 'mentor'));

select throws_ok(
  $$select public.set_google_connection('ciphertext-of-at-least-twenty', 'm@example.com')$$,
  '42501', null,
  'Given a mentor, When they store a Google connection, Then it is refused');

select throws_ok(
  'select * from public.google_connection()',
  '42501', null,
  'Given a mentor, When they read the Google connection, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'owner'));

select lives_ok(
  $$select public.set_google_connection('ciphertext-of-at-least-twenty', 'me@example.com')$$,
  'Given the owner, When they store a Google connection, Then it succeeds');

select is(
  (select google_email from public.google_connection()),
  'me@example.com',
  'Given a stored connection, When the owner reads it, Then it comes back');

select public.clear_google_connection();

select is(
  (select count(*)::int from public.google_connection()),
  0,
  'Given a cleared connection, When the owner reads it, Then there is none');

select * from finish();
rollback;
