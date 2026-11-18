-- Suite: Money, part 8 (the plan runs itself)
--
-- The owner keeps goals in order; what's moved to a goal and spent from it comes from
-- the payments. Claude sets the plan at the plan level, never a goal's saved figures,
-- and removes only goals it added. The engine reads the numbers with the sync's key and
-- writes back this week's amount, the week closed and money set aside (only for goals
-- kept in the account), and raises a missing-transfer alert once.

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

create function pg_temp.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.goals()
returns jsonb
language sql
as $$
  select public.money_budget(date_trunc('month', current_date)::date, current_date)->'goals';
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money8-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money8-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money8-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money8-live-refresh'), 'hex'), now() + interval '1 day');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
select public.job_key_set(encode(sha256('money8-sync'), 'hex'), 'bank-sync', 'Scheduled sync');
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));

-- The owner's goals, in order.
insert into fx values
  ('saver', public.money_save_goal(jsonb_build_object('name', 'Emergency fund', 'kind', 'saving', 'target_pence', 400000,
     'held', 'elsewhere', 'merchant_key', 'example-saver', 'saved_pence', 10000, 'saved_on', current_date - 5))::text),
  ('gifts', public.money_save_goal(jsonb_build_object('name', 'Christmas', 'kind', 'sinking', 'target_pence', 20000,
     'due_on', current_date + 30, 'repeats_yearly', true, 'held', 'account', 'category', 'gifts',
     'saved_pence', 8000, 'saved_on', current_date - 5))::text);
select is((select jsonb_agg(g->>'name') from jsonb_array_elements(pg_temp.goals()) g),
  '["Emergency fund", "Christmas"]'::jsonb, 'Given two goals, then the budget lists them in order');
select throws_ok($$ select public.money_save_goal('{"name": "Bike", "kind": "saving"}'::jsonb) $$, '23514', null,
  'a saving goal needs a target');
select public.money_move_goal((select v::bigint from fx where k = 'gifts'), -1);
select is(pg_temp.goals()->0->>'name', 'Christmas', 'When the owner moves a goal up, then it comes first');
reset role;

-- Progress comes from the payments: a transfer to the saver, and a present bought.
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key, category_id)
values ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money8-move'::bytea), 'hex'),
        current_date - 1, current_date - 1, -15000, 'transfer', 'EXAMPLE SAVER', 'example-saver', null),
       ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money8-gift'::bytea), 'hex'),
        current_date - 1, current_date - 1, -2500, 'card', 'EXAMPLE TOYS', 'example-toys',
        (select id from portal.money_categories where key = 'gifts'));
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is((pg_temp.goals()->1->>'moved_pence')::bigint, 15000::bigint, 'A transfer to the saver counts as moved to the goal');
select is((pg_temp.goals()->0->>'spent_pence')::bigint, 2500::bigint, 'and a present bought counts as spent from Christmas');

-- The floor turns the autopilot on, and a changed plan is worked out afresh this week.
select public.money_save_settings('{"weekly_floor_pence": 12000, "allowance_pence": 16000}'::jsonb);
select is((public.money_budget(date_trunc('month', current_date)::date, current_date)->'settings'->>'weekly_floor_pence')::bigint,
  12000::bigint, 'The owner sets the least a week');
reset role;

-- Claude at the plan level: adds a goal, sets the week, can't change saved figures or remove the owner's goals.
select pg_temp.as_anon();
insert into fx values ('claude', (select public.money_claude_set_plan(jsonb_build_object(
  'goals', jsonb_build_array(jsonb_build_object('name', 'Example loan', 'kind', 'debt', 'saved_pence', 90000,
                                                'payment_pence', 10000, 'apr_bp', 0)),
  'weekly', jsonb_build_object('floor_pence', 11000, 'target_pence', 15000)), encode(sha256('money8-live'), 'hex'))->>'goals_saved'));
select is((select v from fx where k = 'claude'), '1', 'Given plan access, Claude adds a goal');
select public.money_claude_set_plan(jsonb_build_object('goals', jsonb_build_array(jsonb_build_object(
  'id', (select v::bigint from fx where k = 'gifts'), 'saved_pence', 99999, 'target_pence', 25000))),
  encode(sha256('money8-live'), 'hex'));
select is(public.money_claude_set_plan(jsonb_build_object('remove_goals', jsonb_build_array((select v::bigint from fx where k = 'saver'))),
  encode(sha256('money8-live'), 'hex'))->>'goals_removed', '0', 'and cannot remove a goal the owner added');
reset role;
select is((select saved_pence from portal.money_goals where id = (select v::bigint from fx where k = 'gifts')), 8000::bigint,
  'Claude changes a goal''s target, never what it has saved');
select is((select target_pence from portal.money_goals where id = (select v::bigint from fx where k = 'gifts')), 25000::bigint,
  'but the target changes');
select is((select weekly_floor_pence from portal.money_settings where id), 11000::bigint, 'Claude sets the least a week');
select is((select added_by from portal.money_goals where kind = 'debt'), 'claude', 'its goal is marked as Claude''s');

-- Linking a goal to a merchant reads that merchant's payments, so at plan Claude can't,
-- and it never dates a saved figure in the past.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('plan');
reset role;
select pg_temp.as_anon();
select public.money_claude_set_plan(jsonb_build_object('goals', jsonb_build_array(jsonb_build_object(
  'name', 'Example bike', 'kind', 'saving', 'target_pence', 30000, 'merchant_key', 'example-cafe',
  'saved_on', '2025-01-01'))), encode(sha256('money8-live'), 'hex'));
reset role;
select is((select merchant_key from portal.money_goals where name = 'Example bike'), null,
  'Given plan access, Claude cannot link a goal to a merchant');
select is((select saved_on from portal.money_goals where name = 'Example bike'), current_date,
  'and its saved figure is dated today');

-- At summary, Claude can't set the plan.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('summary');
reset role;
select pg_temp.as_anon();
select throws_ok($$ select public.money_claude_set_plan('{"weekly": {"floor_pence": 1}}'::jsonb, encode(sha256('money8-live'), 'hex')) $$,
  '42501', null, 'Given summary access, Claude cannot set the plan');

-- The engine: reads with its key, writes this week's amount and money set aside, only in the account.
select is(jsonb_array_length(public.money_engine_budget(date_trunc('month', current_date)::date, current_date, 'money8-sync')->'goal_moves'),
  1, 'The engine reads the goals'' recent transfers');
select public.money_engine_apply(jsonb_build_object(
  'week_amount', jsonb_build_object('of', current_date, 'pence', 14000), 'closed_week', current_date - 7,
  'payday_transfers', jsonb_build_object('payday', current_date - 3,
    'transfers', jsonb_build_array(jsonb_build_object('goal', 1, 'name', 'Emergency fund', 'pence', 15000))),
  'set_aside', jsonb_build_array(jsonb_build_object('goal', (select v::bigint from fx where k = 'gifts'), 'pence', 500),
                                 jsonb_build_object('goal', (select v::bigint from fx where k = 'saver'), 'pence', 500))),
  'money8-sync');
select throws_ok($$ select public.money_engine_apply('{"closed_week": "2026-11-09"}'::jsonb, 'not-the-key') $$, '42501', null,
  'a wrong key changes nothing');
reset role;
select is((select week_amount_pence from portal.money_settings where id), 14000::bigint, 'When the engine fixes the week, then it holds');
select is((select payday_transfers->'transfers'->0->>'pence' from portal.money_settings where id), '15000',
  'and the payday''s moves are kept as the owner was shown them');
select is((select jsonb_agg(saved_pence order by position) from portal.money_goals where kind <> 'debt' and name <> 'Example bike'), '[8500, 10000]'::jsonb,
  'money is set aside for the goal kept in the account, never for one kept in a saver');

-- A missing transfer: once.
select pg_temp.as_anon();
select is(public.money_raise_alerts(jsonb_build_array(jsonb_build_object('kind', 'transfer-missing',
    'dedupe', 'transfer-missing:' || (select v from fx where k = 'saver') || ':2026-12-31',
    'goal', (select v::bigint from fx where k = 'saver'), 'detail', '{"pence": 15000}'::jsonb)), 'money8-sync')
  + public.money_raise_alerts(jsonb_build_array(jsonb_build_object('kind', 'transfer-missing',
    'dedupe', 'transfer-missing:' || (select v from fx where k = 'saver') || ':2026-12-31',
    'goal', (select v::bigint from fx where k = 'saver'))), 'money8-sync'),
  1, 'A missing transfer raises one alert');
select throws_ok($$ select public.money_save_goal('{"name": "X", "kind": "saving", "target_pence": 1}'::jsonb) $$, '42501', null,
  'Without a session, goals are closed');
reset role;

select * from finish();
rollback;
