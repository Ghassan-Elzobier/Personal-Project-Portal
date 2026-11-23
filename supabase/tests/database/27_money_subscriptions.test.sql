-- Suite: Money, part 10 (subscriptions and the keep-or-cancel check)
--
-- The owner answers "do you still want this?" on a bill (keep or cancel, dated today)
-- and sorts a bill into a category by key, including the new 'learning' one. A
-- category that doesn't exist is refused, and only the owner's session can call it.
-- Claude at summary never sees the answer.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

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

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money10-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money10-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money10-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money10-live-refresh'), 'hex'), now() + interval '1 day');

-- A made-up subscription, already sorted, never reviewed.
insert into portal.money_bills (ident, merchant_key, name, cadence, anchor_on, expected_pence, category_id)
values ('example-streaming', 'example-streaming', 'EXAMPLE STREAMING', 'monthly', current_date - 30, 1000,
        (select id from portal.money_categories where key = 'subscriptions'));
insert into fx values ('bill', (select id from portal.money_bills where ident = 'example-streaming')::text);

select is((select kind from portal.money_categories where key = 'learning'), 'bills',
  'Given the migration, Then a learning and mentoring category exists as a kind of bill');

-- Keep: the answer and today's date are stored, and the owner reads them back.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_bill((select v::bigint from fx where k = 'bill'), p_verdict => 'keep');
reset role;
select is((select verdict from portal.money_bills where ident = 'example-streaming'), 'keep',
  'When the owner keeps a bill, Then the verdict is stored');
select is((select reviewed_on from portal.money_bills where ident = 'example-streaming'), current_date,
  'and the day it was reviewed is today');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(pg_temp.budget()->'bills'->0->>'verdict', 'keep', 'and the owner''s budget carries the answer');
select public.money_set_claude_access('summary');
reset role;
select pg_temp.as_anon();
select is(pg_temp.budget(encode(sha256('money10-live'), 'hex'))->'bills'->0->>'verdict', null,
  'Given summary access, Claude does not see the answer');
reset role;

-- A category by key moves the bill, and leaves the answer alone.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_bill((select v::bigint from fx where k = 'bill'), p_category => 'learning');
reset role;
select is((select c.key from portal.money_bills b join portal.money_categories c on c.id = b.category_id
           where b.ident = 'example-streaming'), 'learning',
  'When the owner sorts a bill as learning, Then it moves there');
select is((select verdict from portal.money_bills where ident = 'example-streaming'), 'keep',
  'and its answer stays as it was');

-- Refusals: a missing category, and anyone but the owner.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select throws_ok(format($$ select public.money_set_bill(%s, p_category => 'no-such-category') $$,
                        (select v from fx where k = 'bill')),
  '22023', null, 'A category that does not exist is refused');
reset role;
select pg_temp.as_anon();
select throws_ok(format($$ select public.money_set_bill(%s, p_verdict => 'keep') $$, (select v from fx where k = 'bill')),
  '42501', null, 'Anonymous callers cannot answer for a bill');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok(format($$ select public.money_set_bill(%s, p_verdict => 'cancel') $$, (select v from fx where k = 'bill')),
  '42501', null, 'nor can a mentor');
reset role;

select * from finish();
rollback;
