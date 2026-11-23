-- Suite: Money, a regular cost as a goal (part 11)
--
-- The owner saves a regular cost with its cost, how often, a setup fee, the bill it
-- replaces and a start day. One without a cost or a cadence is refused. Once started,
-- payments that look like it come with the goal; the bill it replaces is a merchant, so
-- only the owner sees it, and from Claude it needs setup. The engine stores the bill it
-- adopted, once, and never sets money aside for a regular cost.

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

create function pg_temp.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.goal(p_hash text default null)
returns jsonb
language sql
as $$
  select g from jsonb_array_elements(
    public.money_budget(date_trunc('month', current_date)::date, current_date, p_hash)->'goals') g
  where g->>'kind' = 'recurring';
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values ('owner', pg_temp.make_user('money11-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money11-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money11-live-refresh'), 'hex'), now() + interval '1 day');

delete from portal.money_goals;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
select public.job_key_set(encode(sha256('money11-sync'), 'hex'), 'bank-sync', 'Scheduled sync');
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));

insert into fx values ('gym', public.money_save_goal(jsonb_build_object('name', 'Example gym', 'kind', 'recurring',
  'cost_pence', 12000, 'cadence', 'monthly', 'setup_pence', 10000, 'replaces_merchant_key', 'example-gym-old',
  'replace_overlap', true, 'start_on', current_date - 10, 'estimated', true))::text);
select is(pg_temp.goal() - 'id' - 'position' - 'payments' - 'saved_on' - 'moved_pence' - 'spent_pence',
  jsonb_build_object('name', 'Example gym', 'kind', 'recurring', 'target_pence', null, 'due_on', null,
    'repeats_yearly', false, 'held', 'account', 'saved_pence', 0, 'apr_bp', null, 'payment_pence', null,
    'merchant_key', null, 'category', null, 'status', 'active', 'added_by', 'owner', 'cost_pence', 12000,
    'cadence', 'monthly', 'setup_pence', 10000, 'replaces_merchant_key', 'example-gym-old', 'replace_overlap', true,
    'start_on', current_date - 10, 'weekday', null, 'estimated', true, 'bill_id', null),
  'Given the owner saves a regular cost, then the budget returns its cost, cadence, setup, replaced bill and start day');

select throws_ok($$ select public.money_save_goal('{"name": "Swim", "kind": "recurring", "cadence": "weekly"}'::jsonb) $$,
  '23514', null, 'A regular cost without a cost is refused');
select throws_ok($$ select public.money_save_goal('{"name": "Swim", "kind": "recurring", "cost_pence": 500}'::jsonb) $$,
  '23514', null, 'A regular cost without a cadence is refused');
select throws_ok($$ select public.money_save_goal('{"name": "Swim", "kind": "recurring", "cost_pence": 500,
  "cadence": "daily"}'::jsonb) $$, '23514', null, 'A cadence that is not weekly, monthly or yearly is refused');
select lives_ok($$ select public.money_save_goal('{"name": "Bike", "kind": "saving", "target_pence": 30000}'::jsonb) $$,
  'A saving goal still saves as before');
reset role;

-- Payments since a week before the start that look like it: within 15% of the cost.
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key)
values ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money11-a'::bytea), 'hex'),
        current_date - 9, current_date - 9, -12500, 'card', 'EXAMPLE GYM', 'example-gym-new'),
       ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money11-b'::bytea), 'hex'),
        current_date - 9, current_date - 9, -20000, 'card', 'EXAMPLE SHOP', 'example-shop'),
       ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money11-c'::bytea), 'hex'),
        current_date - 30, current_date - 30, -12000, 'card', 'EXAMPLE GYM', 'example-gym-new');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(pg_temp.goal()->'payments', jsonb_build_array(jsonb_build_object('on', current_date - 9, 'pence', 12500,
  'merchant', 'example-gym-new')),
  'Once started, a payment near its cost since a week before the start comes with it, and nothing else');
select public.money_set_claude_access('summary');
reset role;

select pg_temp.as_anon();
select is(pg_temp.goal(encode(sha256('money11-live'), 'hex'))->>'replaces_merchant_key', null,
  'Claude, who is not the owner, never sees the bill it replaces');
select is(pg_temp.goal(encode(sha256('money11-live'), 'hex'))->'payments'->0->>'merchant', '1',
  'and sees a payment''s merchant only as a number');
reset role;

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('plan');
reset role;
select pg_temp.as_anon();
select public.money_claude_set_plan(jsonb_build_object('goals', jsonb_build_array(jsonb_build_object(
  'id', (select v::bigint from fx where k = 'gym'), 'replaces_merchant_key', 'example-other', 'cost_pence', 13000))),
  encode(sha256('money11-live'), 'hex'));
reset role;
select is((select array[replaces_merchant_key, cost_pence::text] from portal.money_goals
           where id = (select v::bigint from fx where k = 'gym')), array['example-gym-old', '13000'],
  'At plan access, Claude changes the cost but cannot link a bill it replaces');

-- The engine stores the bill it adopted, once, and never sets money aside for it.
insert into portal.money_bills (ident, merchant_key, name, cadence, anchor_on, expected_pence, status, added_by)
values ('example-gym-new', 'example-gym-new', 'Example gym', 'monthly', current_date - 9, 12500, 'active', 'engine'),
       ('example-gym-two', 'example-gym-two', 'Example gym two', 'monthly', current_date - 9, 12500, 'active', 'engine');
insert into fx values
  ('bill', (select id from portal.money_bills where ident = 'example-gym-new')::text),
  ('bill2', (select id from portal.money_bills where ident = 'example-gym-two')::text);
select pg_temp.as_anon();
select public.money_engine_apply(jsonb_build_object(
  'goal_bills', jsonb_build_array(jsonb_build_object('goal', (select v::bigint from fx where k = 'gym'),
    'bill', (select v::bigint from fx where k = 'bill'))),
  'set_aside', jsonb_build_array(jsonb_build_object('goal', (select v::bigint from fx where k = 'gym'), 'pence', 500))),
  'money11-sync');
select public.money_engine_apply(jsonb_build_object(
  'goal_bills', jsonb_build_array(jsonb_build_object('goal', (select v::bigint from fx where k = 'gym'),
    'bill', (select v::bigint from fx where k = 'bill2')))), 'money11-sync');
reset role;
select is((select bill_id from portal.money_goals where id = (select v::bigint from fx where k = 'gym')),
  (select id from portal.money_bills where ident = 'example-gym-new'),
  'When the engine adopts the real bill, then the goal keeps it, and a second one does not replace it');
select is((select saved_pence from portal.money_goals where id = (select v::bigint from fx where k = 'gym')), 0::bigint,
  'and the engine never sets money aside for a regular cost');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(pg_temp.goal()->'payments', '[]'::jsonb, 'Once its bill is adopted, no payments come with it');
reset role;

select * from finish();
rollback;
