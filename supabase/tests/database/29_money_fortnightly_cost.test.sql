-- Suite: Money, a regular cost every two weeks (part 12)
--
-- The owner saves a regular cost that comes every two weeks; Claude, at plan access,
-- adds one through its plan tool. Other cadences are still refused.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

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

create function pg_temp.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values ('owner', pg_temp.make_user('money12-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money12-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money12-live-refresh'), 'hex'), now() + interval '1 day');

delete from portal.money_goals;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select lives_ok($$ select public.money_save_goal('{"name": "Example sessions", "kind": "recurring", "cost_pence": 9000,
  "cadence": "fortnightly", "weekday": 2, "estimated": true}'::jsonb) $$,
  'Given the owner saves a regular cost every two weeks, then it saves');
reset role;
select is((select array[cadence, weekday::text] from portal.money_goals where name = 'Example sessions'),
  array['fortnightly', '2'], 'and it keeps its cadence and session day');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select throws_ok($$ select public.money_save_goal('{"name": "Swim", "kind": "recurring", "cost_pence": 500,
  "cadence": "daily"}'::jsonb) $$, '23514', null, 'A cadence that is not weekly, fortnightly, monthly or yearly is refused');
select public.money_set_claude_access('plan');
reset role;

select pg_temp.as_anon();
select public.money_claude_set_plan(jsonb_build_object('goals', jsonb_build_array(jsonb_build_object(
  'name', 'Example club', 'kind', 'recurring', 'cost_pence', 30000, 'cadence', 'monthly', 'setup_pence', 15000,
  'estimated', false))), encode(sha256('money12-live'), 'hex'));
reset role;
select is((select array[kind, cost_pence::text, cadence, setup_pence::text, added_by] from portal.money_goals
           where name = 'Example club'), array['recurring', '30000', 'monthly', '15000', 'claude'],
  'When Claude adds a regular cost with its plan tool, then it saves with its cost, cadence and setup fee');

select * from finish();
rollback;
