-- Suite: Money, part 10 (a typical month for fixed costs)
--
-- The budget's numbers give each category its net total for each of the 6 full months
-- before this one, oldest first (money back in comes off), and only the owner sets a
-- category's monthly budget.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

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

create function pg_temp.energy()
returns jsonb
language sql
as $$
  select c from jsonb_array_elements(public.money_budget(date_trunc('month', current_date)::date,
           (current_date - (extract(isodow from current_date)::int - 1))::date)->'categories') c
  where c->>'key' = 'energy';
$$;


create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money11-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money11-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');

create function pg_temp.pay(p_key text, p_on date, p_pence bigint)
returns void
language sql
as $$
  insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                        description, merchant_key, category_id)
  values ((select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256(p_key::bytea), 'hex'),
          p_on, p_on, p_pence, 'other', 'EXAMPLE ENERGY', 'example-energy',
          (select id from portal.money_categories where key = 'energy'));
$$;

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
reset role;

-- Energy paid last month with a refund the same month, and paid five months ago; this
-- month's payment is not a full month yet.
select pg_temp.pay('money11-last', (date_trunc('month', current_date) - interval '1 month')::date + 3, -6100);
select pg_temp.pay('money11-refund', (date_trunc('month', current_date) - interval '1 month')::date + 20, 900);
select pg_temp.pay('money11-early', (date_trunc('month', current_date) - interval '5 months')::date, -5200);
select pg_temp.pay('money11-now', date_trunc('month', current_date)::date, -5800);

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(jsonb_array_length(pg_temp.energy()->'months'), 6, 'Each category gives 6 months');
select is(pg_temp.energy()->'months', '[0, 5200, 0, 0, 0, 5200]'::jsonb,
  'oldest first, each a full month before this one, net of money back in');

select public.money_set_category_budget('energy', 5650);
select is((pg_temp.energy()->>'budget_pence')::bigint, 5650::bigint,
  'When the owner sets a monthly budget, then the budget reads it');
select public.money_set_category_budget('energy', null);
select is(pg_temp.energy()->'budget_pence', 'null'::jsonb, 'and null clears it');
select throws_ok($$ select public.money_set_category_budget('energy', -1) $$, '22023', null,
  'A budget below 0 is refused');
select throws_ok($$ select public.money_set_category_budget('example-none', 100) $$, '22023', null,
  'and so is a category that does not exist');
reset role;

select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.money_set_category_budget('energy', 100) $$, '42501', null,
  'A mentor cannot set a budget');
reset role;
select is((select budget_pence from portal.money_categories where key = 'energy'), null,
  'and the budget is as the owner left it');

select * from finish();
rollback;
