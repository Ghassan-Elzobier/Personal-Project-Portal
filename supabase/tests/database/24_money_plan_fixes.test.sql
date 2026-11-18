-- Suite: Money, part 9's fixes to part 8
--
-- Linking a goal to a merchant reads that merchant's payments, so Claude can link one
-- only at setup, and never dates a saved figure in the past. The engine keeps the moves
-- the plan asked for on payday.

begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

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

create function pg_temp.claude_goal(p_name text)
returns void
language sql
as $$
  select public.money_claude_set_plan(jsonb_build_object('goals', jsonb_build_array(jsonb_build_object(
    'name', p_name, 'kind', 'saving', 'target_pence', 30000, 'merchant_key', 'example-cafe', 'saved_on', '2025-01-01'))),
    encode(sha256('money10-live'), 'hex'));
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values ('owner', pg_temp.make_user('money10-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money10-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money10-live-refresh'), 'hex'), now() + interval '1 day');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
select public.job_key_set(encode(sha256('money10-sync'), 'hex'), 'bank-sync', 'Scheduled sync');
select public.money_set_claude_access('plan');
reset role;

select pg_temp.as_anon();
select pg_temp.claude_goal('Example bike');
reset role;
select is((select merchant_key from portal.money_goals where name = 'Example bike'), null,
  'Given plan access, Claude cannot link a goal to a merchant');
select is((select saved_on from portal.money_goals where name = 'Example bike'), current_date,
  'and its saved figure is dated today');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('setup');
reset role;
select pg_temp.as_anon();
select pg_temp.claude_goal('Example holiday');
reset role;
select is((select merchant_key from portal.money_goals where name = 'Example holiday'), 'example-cafe',
  'Given setup access, Claude links a goal to a merchant');
select is((select saved_on from portal.money_goals where name = 'Example holiday'), current_date,
  'but still never dates a saved figure in the past');

select pg_temp.as_anon();
select public.money_engine_apply(jsonb_build_object('payday_done', current_date - 3,
  'payday_transfers', jsonb_build_object('payday', current_date - 3,
    'transfers', jsonb_build_array(jsonb_build_object('goal', 1, 'name', 'Emergency fund', 'pence', 15000)))),
  'money10-sync');
reset role;
select is((select payday_transfers->'transfers'->0->>'pence' from portal.money_settings where id), '15000',
  'The engine keeps the payday''s moves as the owner was shown them');

select * from finish();
rollback;
