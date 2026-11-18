-- Suite: Money, part 7 (pay in pounds, for the forecast)
--
-- The owner sets pay steps (one per starting day), and Claude can at the plan level.
-- The engine sorts a pay by itself with the sync's key, adding a rule so the next pay
-- is sorted too, and the budget read gives the steps and the latest pay.

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

create function pg_temp.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function pg_temp.budget()
returns jsonb
language sql
as $$
  select public.money_budget(date_trunc('month', current_date)::date, current_date);
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money7-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money7-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money7-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money7-live-refresh'), 'hex'), now() + interval '1 day');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
select public.job_key_set(encode(sha256('money7-sync'), 'hex'), 'bank-sync', 'Scheduled sync');
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));

-- The owner's pay steps: one per starting day.
select public.money_save_income('{"from_on": "2026-12-31", "pence": 130000}'::jsonb);
select public.money_save_income('{"from_on": "2026-12-31", "pence": 130600, "gross_year_pence": 3400000}'::jsonb);
select is(jsonb_array_length(pg_temp.budget()->'income'), 1, 'Given a step saved twice for one day, then there is one step');
select is((pg_temp.budget()->'income'->0->>'pence')::bigint, 130600::bigint, 'with the newer take-home');
select throws_ok($$ select public.money_save_income('{"from_on": "2027-01-29"}'::jsonb) $$, '22023', null,
  'a step needs its take-home');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_save_income('{"from_on": "2027-01-29", "pence": 1}'::jsonb) $$, '42501', null,
  'a mentor sets no pay');
reset role;

-- Claude: not at summary; at plan it adds and removes steps.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('summary');
reset role;
select pg_temp.as_anon();
select throws_ok($$ select public.money_claude_set_plan('{"income": [{"from_on": "2027-01-29", "pence": 228000}]}'::jsonb, encode(sha256('money7-live'), 'hex')) $$,
  '42501', null, 'Given summary access, Claude cannot set the plan');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('plan');
reset role;
select pg_temp.as_anon();
select is(public.money_claude_set_plan('{"income": [{"from_on": "2027-01-29", "pence": 228000}]}'::jsonb,
  encode(sha256('money7-live'), 'hex'))->>'income_saved', '1', 'Given plan access, Claude adds a pay step');
reset role;
select is((select added_by from portal.money_income where from_on = '2027-01-29'), 'claude', 'marked as Claude''s');
select pg_temp.as_anon();
select is(public.money_claude_set_plan('{"remove_income": ["2027-01-29"]}'::jsonb,
  encode(sha256('money7-live'), 'hex'))->>'income_removed', '1', 'and removes one');
reset role;

-- A pay comes in: the engine sorts it as Pay with a rule, and the next one follows.
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key)
values ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money7-pay'::bytea), 'hex'),
        current_date, current_date, 130550, 'transfer', 'EXAMPLE EMPLOYER LTD', 'example-employer'),
       ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money7-out'::bytea), 'hex'),
        current_date, current_date, -500, 'card', 'EXAMPLE CAFE', 'example-cafe');
insert into fx values
  ('pay', (select id from portal.bank_transactions where merchant_key = 'example-employer')::text),
  ('out', (select id from portal.bank_transactions where merchant_key = 'example-cafe')::text);
select pg_temp.as_anon();
select is(jsonb_array_length(public.money_engine_read(current_date - 30, 'money7-sync')->'incoming'), 1,
  'The engine reads unsorted money in');
select public.money_mark_pay((select v::bigint from fx where k = 'pay'), 'money7-sync');
select throws_ok(format($$ select public.money_mark_pay(%s, 'money7-sync') $$, (select v from fx where k = 'out')),
  '22023', null, 'money out is never pay');
reset role;
select is((select c.key from portal.bank_transactions t join portal.money_categories c on c.id = t.category_id
           where t.id = (select v::bigint from fx where k = 'pay')), 'pay', 'When the engine marks a pay, then it is sorted as Pay');
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key)
values ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money7-pay2'::bytea), 'hex'),
        current_date - 1, current_date - 1, 2000, 'transfer', 'EXAMPLE EMPLOYER LTD', 'example-employer');
select portal.money_categorise();
select is((select c.key from portal.bank_transactions t join portal.money_categories c on c.id = t.category_id
           where t.fingerprint = encode(sha256('money7-pay2'::bytea), 'hex')), 'pay', 'and the next money in from it follows the rule');

-- The outer door: without a session, the owner's functions can't even be called.
select pg_temp.as_anon();
select throws_ok($$ select public.money_save_income('{"from_on": "2027-01-29", "pence": 1}'::jsonb) $$, '42501', null,
  'Without a session, the owner''s pay functions are closed');
select throws_ok($$ select public.money_set_bill(1, 'ignored') $$, '42501', null, 'and so is ignoring a bill');
reset role;

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(pg_temp.budget()->'last_pay', jsonb_build_object('on', current_date, 'pence', 130550),
  'The budget read gives the latest pay');
select public.money_remove_income((select (pg_temp.budget()->'income'->0->>'id')::bigint));
select is(jsonb_array_length(pg_temp.budget()->'income'), 0, 'and the owner removes a step');
reset role;

select * from finish();
rollback;
