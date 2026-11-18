-- Suite: Money, part 1 (the bank connection and its balance)
--
-- Only the owner reads or changes any of it, from a browser session. A job reaches
-- the sync RPCs with its key for that scope, and nothing else. Mentors, anon,
-- connector tokens and wrong keys get nothing, and the tables stay closed to the API
-- roles. A sync is one at a time, a balance is kept only when it changes, and a feed
-- with nothing new for 3 days turns stale.

begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

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

create function pg_temp.act_anon()
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
insert into fx values
  ('owner', pg_temp.make_user('money-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money-live-refresh'), 'hex'), now() + interval '1 day');

-- Given no bank yet, the owner sees settings and nothing else.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(public.money_read()->'connection', 'null'::jsonb, 'Given no bank, when the owner reads, then there is no connection');
select is(public.money_read()->'settings'->>'claude_access', 'setup', 'and Claude''s access starts at setup');
select is(public.money_sync_begin('owner'), null, 'and a sync has nothing to do');

-- When the owner connects an account picked from the feed
insert into fx values ('accounts', (public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb))::text);
select is(jsonb_array_length((select v::jsonb from fx where k = 'accounts')), 1, 'When the owner connects one account, then it is added');
select is(public.money_read()->'accounts'->0->>'last4', '1234', 'and keeps only its last 4 digits');
select is(public.money_read()->'connection'->>'status', 'active', 'and the connection is active');
select throws_ok($$ select public.money_connect('[{"uid": "acc-2", "name": "Savings", "kind": "savings", "last4": "123456"}]'::jsonb) $$,
  '23514', null, 'a full account number is refused');
select throws_ok($$ select public.money_connect('[]'::jsonb) $$, '22023', null, 'connecting no accounts is refused');

-- A sync: one at a time, balances kept only when they change.
insert into fx values ('run', (public.money_sync_begin('connect')->>'run'));
select isnt((select v from fx where k = 'run'), null, 'When a sync starts, then it gets a run');
select is(public.money_sync_begin('owner'), null, 'and a second one while it runs gets nothing');
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
select lives_ok($$ select public.money_ingest((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  '[{"kind": "available", "pence": 318560}]'::jsonb) $$, 'the run stores a balance');
select lives_ok($$ select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok') $$, 'and ends ok');
select is((public.money_read()->'accounts'->0->'balance'->>'pence')::bigint, 318560::bigint, 'then the balance reads back');
select is(public.money_read()->'last_sync'->>'outcome', 'ok', 'and the last sync says ok');
select throws_ok($$ select public.money_ingest((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  '[{"kind": "available", "pence": 1}]'::jsonb) $$, '22023', null, 'a finished run takes no more data');

update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select public.money_ingest((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  '[{"kind": "available", "pence": 318560}]'::jsonb);
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
reset role;
select is((select count(*) from portal.bank_balances)::integer, 1, 'Given the same balance again, then no new row is kept');

-- Nothing new for 3 days: the feed is stale. A new balance makes it active again.
update portal.bank_connections set last_data_at = now() - interval '4 days', created_at = now() - interval '30 days';
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
select is(public.money_read()->'connection'->>'status', 'stale', 'Given nothing new for 3 days, when a sync ends, then the feed is stale');
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select public.money_ingest((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  '[{"kind": "available", "pence": 300000}]'::jsonb);
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
select is(public.money_read()->'connection'->>'status', 'active', 'and a new balance makes it active again');

-- Failures count from the last good sync; Lunch Flow asking to slow down holds syncs off for an hour.
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select throws_ok($$ select public.money_sync_end((select v::bigint from fx where k = 'run'), 'failed', 'Card declined at Example Grocer') $$,
  '23514', null, 'an error is a code, never a message');
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'failed', 'HTTP_500');
select is((public.money_read()->>'failures')::integer, 1, 'When a sync fails, then it counts as one failure');
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'rate-limited', 'HTTP_429');
select is(public.money_sync_begin('owner'), null, 'Given a rate limit, then syncs wait an hour');

-- A run that never finished stops blocking after 10 minutes.
reset role;
delete from portal.bank_sync_runs where outcome = 'rate-limited';
insert into portal.bank_sync_runs (connection_id, trigger, started_at)
select id, 'schedule', now() - interval '11 minutes' from portal.bank_connections;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select isnt(public.money_sync_begin('owner'), null, 'Given a run stuck for 11 minutes, then a new sync can start');
reset role;
select is((select error_code from portal.bank_sync_runs where trigger = 'schedule'), 'TIMED_OUT', 'and the stuck run is closed as timed out');
update portal.bank_sync_runs set outcome = 'ok', finished_at = now() where outcome = 'running';

-- A job with the bank-sync key reaches the sync RPCs, and nothing else.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.job_key_set(encode(sha256('sync-key'), 'hex'), 'bank-sync', 'Vercel cron');
select public.job_key_set(encode(sha256('trolley-key'), 'hex'), 'trolley', 'PC');
reset role;
select pg_temp.act_anon();
select isnt(public.money_sync_begin('schedule', 'sync-key'), null, 'Given the bank-sync key, when a job starts a sync, then it runs');
select throws_ok($$ select public.money_sync_begin('schedule', 'trolley-key') $$, '42501', null, 'a trolley key cannot sync the bank');
select throws_ok($$ select public.money_sync_begin('schedule', 'wrong-key') $$, '42501', null, 'nor can a wrong key');
select throws_ok($$ select public.money_read() $$, '42501', null, 'anon reads nothing');
select throws_ok($$ select public.money_sync_begin('schedule') $$, '42501', null, 'and cannot sync without a key');

-- A mentor
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_read() $$, '42501', null, 'a mentor reads nothing');
select throws_ok($$ select * from portal.bank_accounts $$, '42501', null, 'and cannot reach the tables');

-- Erasing the bank data leaves nothing behind.
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_forget_all();
select is(public.money_read()->'accounts', '[]'::jsonb, 'When the owner erases the bank data, then no account is left');

select * from finish();
rollback;
