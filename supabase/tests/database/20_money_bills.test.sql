-- Suite: Money, part 6 (bills Money finds by itself)
--
-- The engine reads payments and adopts bills with the sync's key (or the owner's
-- session); adopting twice adds nothing, and a bill the owner ignored is never adopted
-- again. The budget lists bills, named for the owner and for Claude only at setup, and
-- a payment to an active bill isn't this week's spending. Alerts are raised once.
-- Erasing the bank data erases the bills.

begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

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

create function pg_temp.budget(p_hash text default null)
returns jsonb
language sql
as $$
  select public.money_budget(date_trunc('month', current_date)::date,
                             (current_date - ((extract(isodow from current_date)::int - 1)))::date, p_hash);
$$;

create function pg_temp.bill(p_ident text, p_pence bigint default 1299)
returns jsonb
language sql
as $$
  select jsonb_build_object('ident', p_ident, 'merchant_key', split_part(p_ident, '~', 1), 'name', 'EXAMPLE STREAMING',
                            'cadence', 'monthly', 'anchor_on', current_date - 30, 'expected_pence', p_pence,
                            'variable', false, 'status', 'active');
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money6-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money6-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money6-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money6-live-refresh'), 'hex'), now() + interval '1 day');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
select public.job_key_set(encode(sha256('money6-sync'), 'hex'), 'bank-sync', 'Scheduled sync');
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
reset role;

-- Three monthly payments to a made-up streaming service, the latest this week; and a grocer sorted as groceries.
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key, category_id)
select (select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256(('money6-' || n)::bytea), 'hex'),
       d, d, p, 'card', t, mk,
       (select id from portal.money_categories where key = c)
from (values (1, current_date - 61, -1299, 'EXAMPLE STREAMING', 'example-streaming', null),
             (2, current_date - 30, -1299, 'EXAMPLE STREAMING', 'example-streaming', null),
             (3, current_date, -1299, 'EXAMPLE STREAMING', 'example-streaming', null),
             (4, current_date, -2000, 'EXAMPLE GROCER', 'example-grocer', 'groceries')) s (n, d, p, t, mk, c);

-- The engine's read: the owner, or the sync's key; nobody else.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(jsonb_array_length(public.money_engine_read(current_date - 456)->'payments'), 3,
  'Given payments, then the engine reads the unsorted money out, not the groceries');
reset role;
select pg_temp.as_anon();
select is(jsonb_array_length(public.money_engine_read(current_date - 456, 'money6-sync')->'payments'), 3,
  'and so does the scheduled sync with its key');
select throws_ok($$ select public.money_engine_read(current_date - 456, 'not-the-key') $$, '42501', null,
  'a wrong key reads nothing');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_engine_read(current_date - 456) $$, '42501', null, 'nor does a mentor');
reset role;

-- Adopting: once, then brought up to date; never an ignored one.
select pg_temp.as_anon();
select is(public.money_adopt_bills(jsonb_build_array(pg_temp.bill('example-streaming')), 'money6-sync'), 1,
  'When the engine adopts a bill, then it is added');
select is(public.money_adopt_bills(jsonb_build_array(pg_temp.bill('example-streaming', 1399)), 'money6-sync'), 0,
  'adopting it again adds nothing');
reset role;
select is((select expected_pence from portal.money_bills where ident = 'example-streaming'), 1399::bigint,
  'but brings its amount up to date');
insert into fx values ('streaming', (select id from portal.money_bills where ident = 'example-streaming')::text);

-- The budget: the bill with its latest payment, and its payment isn't this week's spending.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(pg_temp.budget()->'bills'->0->>'last_paid_on', current_date::text, 'The budget lists the bill with its latest payment');
select is((pg_temp.budget()->>'unsorted_week')::bigint, 0::bigint, 'and a bill''s payment isn''t this week''s spending');
select is(pg_temp.budget()->'bills'->0->>'name', 'EXAMPLE STREAMING', 'the owner sees who it goes to');
select public.money_set_claude_access('summary');
reset role;
select pg_temp.as_anon();
select is(pg_temp.budget(encode(sha256('money6-live'), 'hex'))->'bills'->0->>'name', null,
  'Given summary access, Claude sees the bill without its name');
select throws_ok($$ select public.money_claude_bills('[{"id": 1, "status": "ignored"}]'::jsonb, encode(sha256('money6-live'), 'hex')) $$,
  '42501', null, 'and cannot change bills');
reset role;

-- The owner ignores it: it stops counting and the engine never brings it back.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_bill((select v::bigint from fx where k = 'streaming'), 'ignored');
select is((pg_temp.budget()->>'unsorted_week')::bigint, 1299::bigint, 'When the owner ignores a bill, then its payment is spending again');
reset role;
select pg_temp.as_anon();
select public.money_adopt_bills(jsonb_build_array(pg_temp.bill('example-streaming')), 'money6-sync');
reset role;
select is((select status from portal.money_bills where ident = 'example-streaming'), 'ignored',
  'and the engine never adopts it again');

-- Alerts: once each, bill kinds only, and none for a bill that isn't active.
select pg_temp.as_anon();
select public.money_adopt_bills(jsonb_build_array(pg_temp.bill('example-energy', 7000)), 'money6-sync');
select is(public.money_raise_alerts(jsonb_build_array(
  jsonb_build_object('kind', 'missed-bill', 'dedupe', 'missed-bill:example-energy:2026-11-08', 'ident', 'example-energy'),
  jsonb_build_object('kind', 'missed-bill', 'dedupe', 'missed-bill:example-streaming:2026-11-08', 'ident', 'example-streaming')),
  'money6-sync') + public.money_raise_alerts(jsonb_build_array(
  jsonb_build_object('kind', 'missed-bill', 'dedupe', 'missed-bill:example-energy:2026-11-08', 'ident', 'example-energy')),
  'money6-sync'), 1, 'An alert is raised once, and none for an ignored bill');
select throws_ok($$ select public.money_raise_alerts('[{"kind": "watched", "dedupe": "watched:1", "ident": "example-energy"}]'::jsonb, 'money6-sync') $$,
  '22023', null, 'the engine raises only bill alerts');
reset role;
insert into fx values ('energy', (select id from portal.money_bills where ident = 'example-energy')::text);

-- A mentor changes nothing; erasing the bank data erases the bills.
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok(format($$ select public.money_set_bill(%s, 'active') $$, (select v from fx where k = 'energy')),
  '42501', null, 'A mentor cannot touch a bill');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_forget_all();
reset role;
select is((select count(*) from portal.money_bills), 0::bigint, 'When the owner erases the bank data, then the bills go too');

select * from finish();
rollback;
