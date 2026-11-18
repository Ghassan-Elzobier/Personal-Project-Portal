-- Suite: Money, part 5 (planned purchases)
--
-- The owner plans purchases and cancels them; Claude saves one at the plan level and
-- changes or cancels only its own. The budget read lists what's planned. When the
-- payment arrives, within 25% and 14 days, the plan is paid and leaves the list.

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

create function pg_temp.planned()
returns jsonb
language sql
as $$
  select public.money_budget(date_trunc('month', current_date)::date, current_date)->'planned';
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money5-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money5-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money5-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money5-live-refresh'), 'hex'), now() + interval '1 day');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));

-- The owner plans a purchase, and it shows in the budget.
insert into fx values ('mine', public.money_save_planned(jsonb_build_object(
  'name', 'Train fare', 'pence', 2500, 'due_on', current_date, 'funding', 'allowance'))::text);
select is(jsonb_array_length(pg_temp.planned()), 1, 'Given a planned purchase, then the budget lists it');
select throws_ok($$ select public.money_save_planned('{"name": "Bad", "pence": 0, "due_on": "2026-11-20", "funding": "allowance"}'::jsonb) $$,
  '23514', null, 'a purchase costs something');

-- Claude at plan saves one, and can cancel only its own.
select public.money_set_claude_access('plan');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
insert into fx values ('claude', (public.money_claude_plan_purchase(jsonb_build_object(
  'name', 'Bike repair', 'pence', 6000, 'due_on', current_date + 3, 'funding', 'spread', 'weeks', 3),
  encode(sha256('money5-live'), 'hex'))->>'saved'));
select isnt((select v from fx where k = 'claude'), null, 'Given plan access, Claude saves a purchase the owner chose');
select throws_ok(format($$ select public.money_claude_plan_purchase('{"id": %s, "cancel": true}'::jsonb, encode(sha256('money5-live'), 'hex')) $$,
  (select v from fx where k = 'mine')), 'P0001', null, 'but cannot cancel one the owner added');
select lives_ok(format($$ select public.money_claude_plan_purchase('{"id": %s, "pence": 6500}'::jsonb, encode(sha256('money5-live'), 'hex')) $$,
  (select v from fx where k = 'claude')), 'and can change its own');
reset role;
select is((select pence from portal.money_planned where id = (select v::bigint from fx where k = 'claude')), 6500::bigint, 'to the new amount');
select is((select added_by from portal.money_planned where id = (select v::bigint from fx where k = 'claude')), 'claude', 'marked as Claude''s');

-- At summary, Claude can't plan a purchase.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_claude_access('summary');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.money_claude_plan_purchase('{"name": "X", "pence": 100, "due_on": "2026-11-20", "funding": "safe"}'::jsonb,
  encode(sha256('money5-live'), 'hex')) $$, '42501', null, 'Given summary access, Claude cannot plan a purchase');
reset role;

-- The payment arrives: the plan is paid and leaves the list; one too far off stays.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
insert into fx values ('run', (public.money_sync_begin('owner')->>'run'));
select public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(
    jsonb_build_object('fingerprint', encode(sha256('bike'), 'hex'), 'booked_on', current_date, 'made_on', current_date,
      'pence', -6200, 'method', 'card', 'description', 'EXAMPLE CYCLES')),
  '[]'::jsonb);
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
reset role;
select is((select status from portal.money_planned where id = (select v::bigint from fx where k = 'claude')), 'paid',
  'When a payment within 25% and 14 days arrives, then the plan is paid');
select is((select status from portal.money_planned where id = (select v::bigint from fx where k = 'mine')), 'planned',
  'and a plan the payment doesn''t fit stays planned');

-- The owner cancels; a mentor does nothing.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_cancel_planned((select v::bigint from fx where k = 'mine'));
select is(jsonb_array_length(pg_temp.planned()), 0, 'When the owner cancels, then nothing is planned');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_save_planned('{"name": "X", "pence": 100, "due_on": "2026-11-20", "funding": "safe"}'::jsonb) $$,
  '42501', null, 'a mentor plans nothing');

select * from finish();
rollback;
