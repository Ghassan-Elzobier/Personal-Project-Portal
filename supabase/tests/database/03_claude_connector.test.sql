-- Suite: Claude connector (OAuth codes and tokens for /api/mcp)
--
-- Only the owner can create codes; a code is single use, bound to its client,
-- redirect URI and PKCE challenge; tokens rotate on refresh, stop working when
-- revoked, and the tables are unreachable from the API.

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

create function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.h(p text)
returns text
language sql
as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
grant execute on function pg_temp.h(text) to anon, authenticated;

create temp table fx (k text primary key, v uuid) on commit drop;
grant select on fx to anon, authenticated;
insert into fx values
  ('owner', pg_temp.make_user('owner@test.local')),
  ('mentor', pg_temp.make_user('mentor@test.local'));

insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');

-- RFC 7636 appendix B test vector.
create temp table pkce (verifier text, challenge text) on commit drop;
grant select on pkce to anon, authenticated;
insert into pkce values ('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');

select ok(
  not has_table_privilege('authenticated', 'portal.mcp_tokens', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'portal.mcp_codes', 'select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid = 'portal.mcp_tokens'::regclass),
  'Given the connector tables, When API privileges are inspected, Then neither role has any and RLS is on');

select ok(
  not has_function_privilege('anon', 'public.create_mcp_code(text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_connections()', 'execute')
  and not has_function_privilege('anon', 'public.revoke_mcp_connections()', 'execute'),
  'Given the owner-side RPCs, When anon EXECUTE is inspected, Then none is callable without a session');

select pg_temp.act_as((select v from fx where k = 'mentor'));

select throws_ok(
  $$select public.create_mcp_code(pg_temp.h('c0'), 'client', 'Claude', 'https://claude.ai/api/mcp/auth_callback', (select challenge from pkce))$$,
  '42501', null,
  'Given a mentor, When they approve Claude, Then it is refused');

select pg_temp.act_as((select v from fx where k = 'owner'));

select lives_ok(
  $$select public.create_mcp_code(pg_temp.h('c1'), 'client', 'Claude', 'https://claude.ai/api/mcp/auth_callback', (select challenge from pkce))$$,
  'Given the owner, When they approve Claude, Then a code is stored');

select public.create_mcp_code(pg_temp.h('c2'), 'client', 'Claude', 'https://claude.ai/api/mcp/auth_callback', (select challenge from pkce));
select public.create_mcp_code(pg_temp.h('c3'), 'client', 'Claude', 'https://claude.ai/api/mcp/auth_callback', (select challenge from pkce));

select pg_temp.act_as_anon();

select is(
  public.redeem_mcp_code(pg_temp.h('c2'), 'wrong-verifier-wrong-verifier-wrong-verifier-x', 'client',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.h('a0'), pg_temp.h('r0')),
  false,
  'Given a code, When it is redeemed with the wrong PKCE verifier, Then no token is issued');

select is(
  public.redeem_mcp_code(pg_temp.h('c2'), (select verifier from pkce), 'client',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.h('a0'), pg_temp.h('r0')),
  false,
  'Given a code that failed once, When it is redeemed again correctly, Then it is already used up');

select is(
  public.redeem_mcp_code(pg_temp.h('c3'), (select verifier from pkce), 'other-client',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.h('a0'), pg_temp.h('r0')),
  false,
  'Given a code, When another client redeems it, Then no token is issued');

select is(
  public.redeem_mcp_code(pg_temp.h('c1'), (select verifier from pkce), 'client',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.h('a1'), pg_temp.h('r1')),
  true,
  'Given a fresh code, When it is redeemed with the right verifier, client and redirect, Then tokens are issued');

select is(
  public.redeem_mcp_code(pg_temp.h('c1'), (select verifier from pkce), 'client',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.h('a2'), pg_temp.h('r2')),
  false,
  'Given a redeemed code, When it is redeemed a second time, Then it is refused');

select is(
  (select account_id from public.mcp_session(pg_temp.h('a1'))),
  (select v from fx where k = 'owner'),
  'Given an access token, When the MCP endpoint looks it up, Then it acts for the owner');

select is(
  (select count(*)::int from public.mcp_session(pg_temp.h('nope'))),
  0,
  'Given an unknown token, When it is looked up, Then there is no session');

select is(
  public.refresh_mcp_token(pg_temp.h('r1'), 'client', pg_temp.h('a3'), pg_temp.h('r3')),
  true,
  'Given a refresh token, When it is used, Then new tokens are issued');

select ok(
  (select count(*) from public.mcp_session(pg_temp.h('a1'))) = 0
  and not public.refresh_mcp_token(pg_temp.h('r1'), 'client', pg_temp.h('a4'), pg_temp.h('r4')),
  'Given a rotated pair, When the old access or refresh token is used, Then both are dead');

select is(
  (select count(*)::int from public.mcp_session(pg_temp.h('a3'))),
  1,
  'Given a rotated pair, When the new access token is used, Then it works');

select pg_temp.act_as((select v from fx where k = 'owner'));

select is(
  (select count(*)::int from public.mcp_connections()),
  1,
  'Given one connected app, When the owner lists connections, Then it is there');

select public.revoke_mcp_connections();
select pg_temp.act_as_anon();

select is(
  (select count(*)::int from public.mcp_session(pg_temp.h('a3'))),
  0,
  'Given the owner disconnected Claude, When the old token is used, Then there is no session');

select * from finish();
rollback;
