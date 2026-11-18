-- Suite: Money, part 3 (categories, rules, watched merchants, Claude's access)
--
-- Payments are sorted by the first matching rule, the starter set included, and a
-- category the owner sets by hand is never changed by a rule. "Always" makes a rule
-- that sorts the past too. A watched merchant paid this week raises one alert. Claude
-- reads totals and changes the plan only at the level the owner set, never the level
-- itself; a mentor and anon get nothing.

begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

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

create function pg_temp.row(p_fp text, p_day date, p_pence bigint, p_text text, p_merchant text)
returns jsonb
language sql
as $$
  select jsonb_build_object('fingerprint', encode(sha256(convert_to(p_fp, 'UTF8')), 'hex'), 'booked_on', p_day,
    'made_on', p_day, 'pence', p_pence, 'method', 'card', 'description', p_text, 'merchant_key', p_merchant);
$$;

-- A payment's category key, a payment's id and a category's id, read as the test's
-- superuser: the tables are closed to the roles the test acts as.
create function pg_temp.cat(p_text text)
returns text
language sql
security definer
as $$
  select (select key from portal.money_categories where id = t.category_id)
  from portal.bank_transactions t where t.description = p_text;
$$;

create function pg_temp.txn(p_text text)
returns bigint
language sql
security definer
as $$
  select id from portal.bank_transactions where description = p_text;
$$;

create function pg_temp.catid(p_key text)
returns bigint
language sql
security definer
as $$
  select id from portal.money_categories where key = p_key;
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money3-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money3-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('money3-live'), 'hex'), now() + interval '1 hour',
   encode(sha256('money3-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v::uuid from fx where k = 'mentor'), 'test', encode(sha256('money3-mentor'), 'hex'), now() + interval '1 hour',
   encode(sha256('money3-mentor-refresh'), 'hex'), now() + interval '1 day');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
insert into fx values ('run', (public.money_sync_begin('connect')->>'run'));
select public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(
    pg_temp.row('a', current_date - 2, -1234, 'SAINSBURYS S/MKTS LONDON', 'sainsburys-smkts'),
    pg_temp.row('b', current_date - 2, -1800, 'EXAMPLE TAKEAWAY ORDER', 'example-takeaway'),
    pg_temp.row('c', current_date - 40, -900, 'EXAMPLE TAKEAWAY ORDER OLD', 'example-takeaway'),
    pg_temp.row('d', current_date - 1, -350, 'EXAMPLE CAFE', 'example-cafe')),
  '[]'::jsonb);
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');

-- The starter rules sort what they know.
select is(pg_temp.cat('SAINSBURYS S/MKTS LONDON'), 'groceries', 'Given a supermarket payment, then the starter rules call it groceries');
select is(pg_temp.cat('EXAMPLE CAFE'), null, 'and a merchant no rule knows stays unsorted');
select ok((public.money_read()->>'unsorted')::integer >= 1, 'and this month counts it as unsorted');

-- By hand, and "always": a rule for the merchant that sorts the past too.
select public.money_set_category(pg_temp.txn('EXAMPLE TAKEAWAY ORDER'),
  pg_temp.catid('eating-out'), true);
select is(pg_temp.cat('EXAMPLE TAKEAWAY ORDER OLD'), 'eating-out', 'When the owner sorts a takeaway with "always", then the older one is sorted too');
select is((select t->>'category_by' from jsonb_array_elements(public.money_transactions('2000-01-01')) t
           where t->>'description' = 'EXAMPLE TAKEAWAY ORDER'), 'owner', 'and the one sorted by hand is the owner''s');
select public.money_set_category(pg_temp.txn('SAINSBURYS S/MKTS LONDON'),
  pg_temp.catid('household'), false);
reset role;
delete from portal.money_rules where pattern = 'example-takeaway';
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_set_category(pg_temp.txn('EXAMPLE CAFE'), null, false);
select is(pg_temp.cat('SAINSBURYS S/MKTS LONDON'), 'household', 'Given a payment sorted by hand, then the rules never change it');
select is(pg_temp.cat('EXAMPLE TAKEAWAY ORDER OLD'), null, 'and one a removed rule sorted goes back to unsorted');
select is(pg_temp.cat('EXAMPLE TAKEAWAY ORDER'), 'eating-out', 'while the one sorted by hand keeps its category');

-- This month's money out by category.
select is((select (c->>'out_pence')::bigint from jsonb_array_elements(public.money_read()->'categories') c where c->>'key' = 'eating-out'),
  case when current_date - 2 >= date_trunc('month', current_date)::date then 1800::bigint else 0::bigint end,
  'This month''s money out shows against its category');

-- Claude at setup: reads totals, plans categories, budgets, rules and a watched merchant.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select ok(public.money_claude_history(3, encode(sha256('money3-live'), 'hex')) ? 'merchants', 'Given setup access, Claude reads the totals');
select is((select array_agg(distinct k order by k)
           from jsonb_array_elements(public.money_claude_history(3, encode(sha256('money3-live'), 'hex'))->'merchants') m,
                jsonb_object_keys(m) k),
  array['category', 'count', 'last_on', 'merchant', 'monthly_avg_pence', 'name'],
  'and never a single payment: merchants carry totals only');
select is((public.money_claude_plan(jsonb_build_object(
    'categories', jsonb_build_array(
      jsonb_build_object('key', 'mentoring', 'name', 'Mentoring', 'kind', 'bills', 'budget_pence', 18000),
      jsonb_build_object('key', 'groceries', 'budget_pence', 30000)),
    'rules', jsonb_build_array(
      jsonb_build_object('field', 'merchant', 'pattern', 'example-cafe', 'category', 'eating-out'),
      jsonb_build_object('field', 'description', 'pattern', 'takeaway', 'watch', true)),
    'settings', jsonb_build_object('buffer_pence', 50000, 'buffer_from', '2027-01-29')),
  encode(sha256('money3-live'), 'hex'))->>'rules')::integer, 2, 'and plans categories, budgets, rules and settings in one go');
reset role;
select is((select budget_pence from portal.money_categories where key = 'groceries'), 30000::bigint, 'the groceries budget is set');
select is((select buffer_pence from portal.money_settings), 50000::bigint, 'and the buffer');
select is(pg_temp.cat('EXAMPLE CAFE'), 'eating-out', 'and the new rule sorts the cafe');
set local role anon;
select throws_ok($$ select public.money_claude_plan('{"settings": {"claude_access": "setup"}}'::jsonb, encode(sha256('money3-live'), 'hex')) $$,
  '42501', null, 'Claude can never change its own access');

-- A watched merchant paid this week raises one alert; an old payment raises none.
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
update fx set v = (public.money_sync_begin('owner')->>'run') where k = 'run';
select public.money_ingest_transactions((select v::bigint from fx where k = 'run'), (select v::bigint from fx where k = 'account'),
  jsonb_build_array(
    pg_temp.row('e', current_date, -2200, 'EXAMPLE TAKEAWAY ORDER NEW', 'example-takeaway'),
    pg_temp.row('f', current_date - 30, -1100, 'EXAMPLE TAKEAWAY ORDER LATE', 'example-takeaway')),
  '[]'::jsonb);
select public.money_sync_end((select v::bigint from fx where k = 'run'), 'ok');
select is(jsonb_array_length(public.money_read()->'alerts'), 1, 'When a watched merchant is paid this week, then one alert is raised');
select is(public.money_read()->'alerts'->0->'payment'->>'pence', '-2200', 'for that payment');
select public.money_dismiss_alert((public.money_read()->'alerts'->0->>'id')::bigint);
select is(jsonb_array_length(public.money_read()->'alerts'), 0, 'and dismissing it clears it');

-- The access level: the owner sets it in the app; below setup, Claude plans nothing.
select public.money_set_claude_access('summary');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.money_claude_history(3, encode(sha256('money3-live'), 'hex')) $$, '42501', null,
  'Given summary access, Claude cannot read the history');
select throws_ok($$ select public.money_claude_plan('{}'::jsonb, encode(sha256('money3-live'), 'hex')) $$, '42501', null,
  'nor change the plan');
select throws_ok($$ select public.money_claude_history(3, encode(sha256('money3-mentor'), 'hex')) $$, '42501', null,
  'a mentor''s token gets nothing at any level');
select throws_ok($$ select public.money_set_category(1, null, false) $$, '42501', null, 'and anon sorts nothing');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_set_claude_access('setup') $$, '42501', null, 'nor can a mentor set the access');

-- Erasing the bank data takes the alerts with it, and keeps the plan.
reset role;
insert into portal.money_alerts (kind, dedupe) values ('watched', 'watched:test');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_forget_all();
reset role;
select is((select count(*)::integer from portal.money_alerts), 0, 'When the owner erases the bank data, then the alerts go too');
select is((select budget_pence from portal.money_categories where key = 'groceries'), 30000::bigint, 'and the budgets stay');

select * from finish();
rollback;
