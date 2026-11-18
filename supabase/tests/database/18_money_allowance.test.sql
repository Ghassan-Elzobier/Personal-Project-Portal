-- Suite: Money, part 4 (the weekly amount and safe-to-spend)
--
-- money_budget gives the balance, the settings and each category's money out this
-- month, this week and last week, pending payments included, to the owner and to
-- Claude at the summary level, never below. Settings are saved by the owner or
-- Claude's plan, never Claude's own access.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

create function pg_temp.row(p_fp text, p_day date, p_pence bigint, p_text text)
returns jsonb
language sql
as $$
  select jsonb_build_object('fingerprint', encode(sha256(convert_to(p_fp, 'UTF8')), 'hex'), 'booked_on', p_day,
    'made_on', p_day, 'pence', p_pence, 'method', 'card', 'description', p_text, 'merchant_key', null);
$$;

create function pg_temp.cat(p_budget jsonb, p_key text)
returns jsonb
language sql
as $$
  select c from jsonb_array_elements(p_budget->'categories') c where c->>'key' = p_key;
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money4-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money4-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money4-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money4-live-refresh'), 'hex'), now() + interval '1 day');

-- Given a balance and payments: groceries this week and last, rent this month.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
insert into fx values ('run', (public.money_sync_begin('connect')->>'run'));
select public.money_ingest((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  '[{"kind": "available", "pence": 300000}]'::jsonb);
select public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(
    pg_temp.row('a', '2026-11-17', -3500, 'TESCO STORES'),
    pg_temp.row('b', '2026-11-12', -7000, 'TESCO STORES 2'),
    pg_temp.row('c', '2026-11-08', -50000, 'EXAMPLE LETTINGS RENT'),
    pg_temp.row('d', '2026-11-17', -500, 'EXAMPLE STALL')),
  jsonb_build_array(pg_temp.row('p', '2026-11-18', -250, 'TESCO EXPRESS') - 'booked_on'));
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
select public.money_claude_plan(jsonb_build_object(
  'categories', jsonb_build_array(jsonb_build_object('key', 'rent', 'budget_pence', 50000)),
  'rules', jsonb_build_array(jsonb_build_object('field', 'description', 'pattern', 'example lettings', 'category', 'rent'))));

insert into fx values ('budget', public.money_budget('2026-11-01', '2026-11-16')::text);
select is(((select v::jsonb from fx where k = 'budget')->>'balance_pence')::bigint, 300000::bigint, 'The owner reads the balance');
select is((pg_temp.cat((select v::jsonb from fx where k = 'budget'), 'groceries')->>'spent_week')::bigint, 3750::bigint,
  'groceries spent this week, the pending one included');
select is((pg_temp.cat((select v::jsonb from fx where k = 'budget'), 'groceries')->>'spent_last_week')::bigint, 7000::bigint,
  'and last week');
select is((pg_temp.cat((select v::jsonb from fx where k = 'budget'), 'rent')->>'paid_month')::bigint, 50000::bigint,
  'rent paid this month');
select is(((select v::jsonb from fx where k = 'budget')->>'unsorted_week')::bigint, 500::bigint, 'and what isn''t sorted this week');

-- Settings: the owner sets the weekly amount and the first payday; Claude's plan can too.
select public.money_save_settings('{"allowance_pence": 16000, "first_payday": "2026-12-31"}'::jsonb);
select is(public.money_budget('2026-11-01', '2026-11-16')->'settings'->>'allowance_pence', '16000', 'The owner sets the weekly amount');
select is(public.money_budget('2026-11-01', '2026-11-16')->'settings'->>'first_payday', '2026-12-31', 'and the first payday');
select public.money_claude_plan('{"settings": {"allowance_pence": 21400, "buffer_pence": 20000}}'::jsonb);
select is(public.money_budget('2026-11-01', '2026-11-16')->'settings'->>'allowance_pence', '21400', 'and the plan can change it');
select throws_ok($$ select public.money_save_settings('{"claude_access": "setup"}'::jsonb) $$, '42501', null,
  'settings never carry Claude''s access');

-- Claude at summary reads the budget; off, it reads nothing.
select public.money_set_claude_access('summary');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((public.money_budget('2026-11-01', '2026-11-16', encode(sha256('money4-live'), 'hex'))->>'balance_pence')::bigint,
  300000::bigint, 'Given summary access, Claude reads the budget');
select throws_ok($$ select public.money_claude_plan('{}'::jsonb, encode(sha256('money4-live'), 'hex')) $$, '42501', null,
  'but cannot change the plan');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('off');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.money_budget('2026-11-01', '2026-11-16', encode(sha256('money4-live'), 'hex')) $$, '42501', null,
  'Given access off, Claude reads nothing');
select throws_ok($$ select public.money_budget('2026-11-01', '2026-11-16') $$, '42501', null, 'nor does anon');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_save_settings('{"allowance_pence": 1}'::jsonb) $$, '42501', null, 'and a mentor changes nothing');

select * from finish();
rollback;
