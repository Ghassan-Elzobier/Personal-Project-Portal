-- Suite: Money, part 2 (transactions and statements)
--
-- Syncs never double a booked payment, whether Lunch Flow sends its id or not, and
-- the pending set is replaced each time. A statement adds each file once; when the
-- feed later brings the same day and amount, its row replaces the statement's and
-- keeps the note. Only the owner reads transactions or uploads; a job reaches only
-- the sync RPCs, with its key.

begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

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

-- A booked row in the shape the app sends, with a made-up fingerprint.
create function pg_temp.row(p_fp text, p_day date, p_pence bigint, p_text text, p_ref text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object('ref', p_ref, 'fingerprint', encode(sha256(convert_to(p_fp, 'UTF8')), 'hex'),
    'booked_on', p_day, 'made_on', p_day, 'pence', p_pence, 'method', 'card', 'description', p_text,
    'merchant_key', 'example-grocer');
$$;

create function pg_temp.count(p_status text, p_source text default null)
returns integer
language sql
as $$
  select count(*)::integer from jsonb_array_elements(public.money_transactions('2026-01-01')) t
  where t->>'status' = p_status and (p_source is null or t->>'source' = p_source);
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money2-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money2-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
insert into fx values ('run', (public.money_sync_begin('connect')->>'run'));

-- The first sync: two booked payments and one pending.
select is(public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(pg_temp.row('a', '2026-11-10', -1234, 'EXAMPLE GROCER', 'lf-1'), pg_temp.row('b', '2026-11-11', -4500, 'EXAMPLE ENERGY', 'lf-2')),
  jsonb_build_array(pg_temp.row('p', '2026-11-12', -350, 'EXAMPLE CAFE') - 'booked_on')),
  2, 'Given a first sync, when it brings two booked payments, then both are new');
select is(pg_temp.count('booked'), 2, 'and both are stored');
select is(pg_temp.count('pending'), 1, 'with the pending one');
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
select is((public.money_read()->'last_sync'->>'outcome'), 'ok', 'and the sync ends ok');

-- The next sync overlaps: the same booked payments again, and the pending one now booked.
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select is((public.money_sync_begin('owner')), null, 'a second sync waits while one runs');
select is(public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(
    pg_temp.row('a', '2026-11-10', -1234, 'EXAMPLE GROCER', 'lf-1'),
    pg_temp.row('b2', '2026-11-11', -4500, 'EXAMPLE ENERGY LTD', 'lf-2'),
    pg_temp.row('p2', '2026-11-13', -350, 'EXAMPLE CAFE', 'lf-3')),
  '[]'::jsonb),
  1, 'When the overlap comes again, then only the payment that was pending is new (by id, even with new text)');
select is(pg_temp.count('booked'), 3, 'so each payment is there once');
select is(pg_temp.count('pending'), 0, 'and the pending set is replaced');
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');

-- Without Lunch Flow's id, the fingerprint still keeps a payment single.
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select is(public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(pg_temp.row('a', '2026-11-10', -1234, 'EXAMPLE GROCER')), '[]'::jsonb),
  0, 'Given a payment again with no id, then its fingerprint keeps it single');
select is((public.money_sync_begin('owner')), null, 'still one sync at a time');
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
update fx set v = (public.money_sync_begin('owner')->'accounts'->0->>'latest') where k = 'run';
select is((select v from fx where k = 'run'), '2026-11-13', 'and the next sync starts from the last day the feed booked');
reset role;
update portal.bank_sync_runs set outcome = 'ok', finished_at = now() where outcome = 'running';

-- A statement fills a day the feed missed, once per file.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(public.money_upload_statement((select v::bigint from fx where k = 'account'), encode(sha256('statement-1'), 'hex'),
  '2026-11-01', '2026-11-05', jsonb_build_array(pg_temp.row('s1', '2026-11-03', -2000, 'EXAMPLE SHOP') - 'ref'), 4),
  1, 'Given a statement with a day the feed missed, when it is uploaded, then that row is added');
select throws_ok($$ select public.money_upload_statement((select v::bigint from fx where k = 'account'), encode(sha256('statement-1'), 'hex'),
  '2026-11-01', '2026-11-05', '[]'::jsonb, 0) $$, 'P0001', 'That statement is in already.', 'the same file again is refused');
reset role;
update portal.bank_transactions set note = 'Birthday present' where source = 'statement';
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
insert into fx values ('run2', (public.money_sync_begin('owner')->>'run'));
select public.money_ingest_transactions((select v::bigint from fx where k = 'run2'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(pg_temp.row('f1', '2026-11-03', -2000, 'EXAMPLE SHOP LONDON', 'lf-9')), '[]'::jsonb);
select is(pg_temp.count('booked', 'statement'), 0, 'When the feed brings the same day and amount, then the statement row goes');
select is((select t->>'note' from jsonb_array_elements(public.money_transactions('2026-01-01')) t where t->>'description' = 'EXAMPLE SHOP LONDON'),
  'Birthday present', 'and the feed row keeps its note');

-- Who gets in
select public.job_key_set(encode(sha256('sync-key-2'), 'hex'), 'bank-sync', 'Vercel cron');
select isnt(public.money_read()->'sync_key', 'null'::jsonb, 'the scheduled sync''s key shows as registered');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.money_transactions('2026-01-01') $$, '42501', null, 'anon reads no transactions');
select throws_ok($$ select public.money_ingest_transactions((select v::bigint from fx where k = 'run2'), (select v::bigint from fx where k = 'account'),
  '[]'::jsonb, '[]'::jsonb, 'wrong-key') $$, '42501', null, 'and a wrong key ingests nothing');
select lives_ok($$ select public.money_ingest_transactions((select v::bigint from fx where k = 'run2'), (select v::bigint from fx where k = 'account'),
  '[]'::jsonb, '[]'::jsonb, 'sync-key-2') $$, 'the sync key ingests');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_transactions('2026-01-01') $$, '42501', null, 'a mentor reads no transactions');

select * from finish();
rollback;
