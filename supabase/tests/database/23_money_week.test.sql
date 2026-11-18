-- Suite: Money, part 9 (the weekly summary)
--
-- The budget's numbers give each category's spending for the 8 weeks before this one
-- (a bill's payments left out), and the week the engine closed, as it recorded it.

begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

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

create function pg_temp.budget()
returns jsonb
language sql
as $$
  select public.money_budget(date_trunc('month', current_date)::date,
                             (current_date - (extract(isodow from current_date)::int - 1))::date);
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values ('owner', pg_temp.make_user('money9-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
select public.job_key_set(encode(sha256('money9-sync'), 'hex'), 'bank-sync', 'Scheduled sync');
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
reset role;

-- A meal out last week, and an unsorted payment three weeks ago.
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key, category_id)
values ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money9-meal'::bytea), 'hex'),
        current_date - (extract(isodow from current_date)::int - 1) - 3, current_date - (extract(isodow from current_date)::int - 1) - 3,
        -2400, 'card', 'EXAMPLE CAFE', 'example-cafe', (select id from portal.money_categories where key = 'eating-out')),
       ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256('money9-odd'::bytea), 'hex'),
        current_date - (extract(isodow from current_date)::int - 1) - 17, current_date - (extract(isodow from current_date)::int - 1) - 17,
        -900, 'card', 'EXAMPLE STALL', 'example-stall', null);

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(jsonb_array_length((select c->'weeks' from jsonb_array_elements(pg_temp.budget()->'categories') c where c->>'key' = 'eating-out')),
  8, 'Each category gives 8 weeks of spending');
select is((select c->'weeks'->7 from jsonb_array_elements(pg_temp.budget()->'categories') c where c->>'key' = 'eating-out'),
  '2400'::jsonb, 'last week is the newest of them');
select is(pg_temp.budget()->'unsorted_weeks'->5, '900'::jsonb, 'and the unsorted spending three weeks ago sits three from the end');
reset role;

-- The engine records the week it closed.
select set_config('request.jwt.claims', '', true);
set local role anon;
select public.money_engine_apply(jsonb_build_object('closed_week', current_date - 7,
  'last_week', jsonb_build_object('week', current_date - 7, 'amount_pence', 15000, 'spent_pence', 12000,
                                  'swept', jsonb_build_array(jsonb_build_object('goal', 1, 'name', 'Christmas', 'pence', 3000)))),
  'money9-sync');
select throws_ok($$ select public.money_engine_apply('{"last_week": {"week": "2026-11-09"}}'::jsonb) $$, '42501', null,
  'without its key, the engine records nothing');
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is((pg_temp.budget()->'settings'->'last_week'->>'amount_pence')::bigint, 15000::bigint,
  'When the engine closes a week, then the summary reads what it recorded');
reset role;

select * from finish();
rollback;
