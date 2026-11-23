-- Suite: Money, the budget over years of bank history
--
-- Two indexes keep the budget from reading the whole payment history: one category
-- between two days, and money out to one merchant, newest first. With several years
-- of made-up payments, each bill's latest payment is still its newest matching one (a
-- same-merchant payment outside the 15% band, or money in, isn't it), and this week's
-- spending still leaves out bill payments.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

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

create function pg_temp.week_start()
returns date
language sql
as $$
  select (current_date - (extract(isodow from current_date)::int - 1))::date;
$$;

create function pg_temp.budget()
returns jsonb
language sql
as $$
  select public.money_budget(date_trunc('month', current_date)::date, pg_temp.week_start());
$$;

select has_index('portal', 'bank_transactions', 'bank_transactions_category_day_idx', array['category_id', 'made_on'],
  'Given the migration, Then payments are indexed by category and day');
select has_index('portal', 'bank_transactions', 'bank_transactions_merchant_day_idx', array['merchant_key', 'made_on', 'id'],
  'and by merchant, day and id, for a bill''s latest payment');

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated;
insert into fx values ('owner', pg_temp.make_user('history-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values ('account', (public.money_read()->'accounts'->0->>'id'));
reset role;

-- A made-up gym membership of 30 pounds, told apart by amount, sorted as a subscription.
insert into portal.money_bills (ident, merchant_key, band_pence, name, cadence, anchor_on, expected_pence, category_id)
values ('example-gym~3000', 'example-gym', 3000, 'EXAMPLE GYM', 'monthly', pg_temp.week_start(), 3000,
        (select id from portal.money_categories where key = 'subscriptions'));

-- Four years of history: the membership every month up to this Monday, groceries most
-- days, and, today, a same-merchant payment far outside the band and a refund (money in).
insert into portal.bank_transactions (account_id, status, source, fingerprint, booked_on, made_on, pence, method,
                                      description, merchant_key, category_id)
select (select v::bigint from fx where k = 'account'), 'booked', 'lunchflow', encode(sha256(('history-' || n)::bytea), 'hex'),
       d, d, p, 'card', t, mk, (select id from portal.money_categories where key = c)
from (select m, pg_temp.week_start() - 30 * m, -3000 - (m % 3) * 100, 'EXAMPLE GYM', 'example-gym', 'subscriptions'
      from generate_series(0, 47) m
      union all
      select 1000 + g, current_date - g, -(500 + g % 900), 'EXAMPLE GROCER', 'example-grocer', 'groceries'
      from generate_series(1, 1400) g
      union all
      values (5000, current_date, -9000::bigint, 'EXAMPLE GYM', 'example-gym', 'subscriptions'),
             (5001, current_date, 3000::bigint, 'EXAMPLE GYM', 'example-gym', 'subscriptions')) s (n, d, p, t, mk, c);

insert into fx values ('grocer_month', (select -sum(pence) from portal.bank_transactions
  where merchant_key = 'example-grocer' and made_on >= date_trunc('month', current_date)::date)::text);

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(pg_temp.budget()->'bills'->0->>'last_paid_on', pg_temp.week_start()::text,
  'When the budget is read, Then the bill''s latest payment is its newest matching one');
select is((pg_temp.budget()->'bills'->0->>'last_pence')::bigint, 3000::bigint,
  'with its amount, not the refund''s nor the payment outside the band');
select is((select (c->>'spent_week')::bigint from jsonb_array_elements(pg_temp.budget()->'categories') c
           where c->>'key' = 'subscriptions'), 9000::bigint,
  'and this week''s spending leaves out the bill''s payment but keeps the one outside the band');
select is((select (c->>'paid_month')::bigint from jsonb_array_elements(pg_temp.budget()->'categories') c
           where c->>'key' = 'groceries'),
          (select v::bigint from fx where k = 'grocer_month'),
  'and a category''s month counts only this month''s payments');
reset role;

select * from finish();
rollback;
