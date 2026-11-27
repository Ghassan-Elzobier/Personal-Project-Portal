-- Suite: a shop lands in one step (20261127225541_life_land_shop.sql)
--
-- life_land_shop makes a shop's stock changes and saves the week's plan together:
-- if any part fails, the kitchen and the plan are exactly as they were. A shop
-- already in is refused, so a repeated tap never adds the food twice, and so is
-- an undo of a shop that is not in. Only the owner may call it. life_stock still
-- works as before.

begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

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

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('land-owner@test.local')::text),
  ('mentor', pg_temp.make_user('land-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('land-live'), 'hex'), now() + interval '1 hour', encode(sha256('land-live-refresh'), 'hex'), now() + interval '1 day');

-- Reads go through life_read, as the app's do.
create function pg_temp.stock(p_item text)
returns numeric
language sql
as $$
  select (s->>'qty')::numeric from jsonb_array_elements(public.life_read('2027-03-01')->'stock') s where s->>'item' = p_item;
$$;

create function pg_temp.plan(p_start date)
returns jsonb
language sql
as $$
  select p->'data' from jsonb_array_elements(public.life_read(p_start)->'plans') p where (p->>'start')::date = p_start;
$$;

-- The owner, with a batch week and a fresh week, and some food at home.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.life_save_plan('2027-03-01', '{"shop": {"ticked": ["example-oats"]}}');
select public.life_save_plan('2027-03-08', '{"trips": [{"id": "t1", "date": "2027-03-08"}, {"id": "t2", "date": "2027-03-11"}]}');
select public.life_stock('[{"item": "example-oats", "qty": 200}, {"item": "example-rice", "qty": 50, "good_until": "2027-03-02"}]', 'set');

-- A batch week's shop
select lives_ok($$
  select public.life_land_shop('2027-03-01',
    '[{"mode": "set", "changes": [{"item": "example-rice", "qty": 0}]},
      {"mode": "add", "changes": [{"item": "example-oats", "qty": 500}, {"item": "example-rice", "qty": 1000, "good_until": "2027-03-10"}]}]',
    '{"shop": {"ticked": ["example-oats"], "deliveredOn": "2027-03-01", "added": [{"item": "example-oats", "qty": 500}]}}')
$$, 'Given a batch week''s shop is confirmed, then it lands');
select is(pg_temp.stock('example-oats'), 700.00, 'its food is added to stock');
select is(pg_temp.stock('example-rice'), 1000.00, 'a fresh pack replaces the remainder past its date, as the steps say, in order');
select is(pg_temp.plan('2027-03-01')->'shop'->>'deliveredOn', '2027-03-01', 'and the plan says the shop is in');

select throws_ok($$
  select public.life_land_shop('2027-03-01',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": 500}]}]',
    '{"shop": {"deliveredOn": "2027-03-01"}}')
$$, '22023', 'This week''s delivery is already in.', 'When the same shop is confirmed again, then it is refused');
select is(pg_temp.stock('example-oats'), 700.00, 'and its food went up only once');

select lives_ok($$
  select public.life_land_shop('2027-03-01',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": -500}]}]',
    '{"shop": {"ticked": ["example-oats"]}}')
$$, 'When the shop is undone, then it goes back');
select is(pg_temp.stock('example-oats'), 200.00, 'its food comes back out');
select is(pg_temp.plan('2027-03-01')->'shop'->>'deliveredOn', null, 'and the plan says the shop is not in');
select throws_ok($$
  select public.life_land_shop('2027-03-01',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": -500}]}]',
    '{"shop": {}}')
$$, '22023', 'No delivery to undo.', 'When it is undone again, then it is refused');
select is(pg_temp.stock('example-oats'), 200.00, 'and the food came out only once');

-- A fresh week's shop, named by p_trip
select lives_ok($$
  select public.life_land_shop('2027-03-08',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": 300}]}]',
    '{"trips": [{"id": "t1", "date": "2027-03-08", "doneOn": "2027-03-08"}, {"id": "t2", "date": "2027-03-11"}]}', 't1')
$$, 'Given a fresh week''s shop is confirmed, then it lands');
select is(pg_temp.stock('example-oats'), 500.00, 'its food is added to stock');
select throws_ok($$
  select public.life_land_shop('2027-03-08',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": 300}]}]',
    '{"trips": [{"id": "t1", "date": "2027-03-08", "doneOn": "2027-03-08"}, {"id": "t2", "date": "2027-03-11"}]}', 't1')
$$, '22023', 'That shop is done already.', 'When the same shop is confirmed again, then it is refused');
select is(pg_temp.stock('example-oats'), 500.00, 'and its food went up only once');
select lives_ok($$
  select public.life_land_shop('2027-03-08',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": 100}]}]',
    '{"trips": [{"id": "t1", "date": "2027-03-08", "doneOn": "2027-03-08"}, {"id": "t2", "date": "2027-03-11", "doneOn": "2027-03-11"}]}', 't2')
$$, 'the week''s other shop still lands');
select throws_ok($$
  select public.life_land_shop('2027-03-08', '[]',
    '{"trips": [{"id": "t9", "doneOn": "2027-03-08"}]}', 't9')
$$, 'P0002', 'That shop is not in this week''s plan.', 'a shop not in the plan is refused');
select throws_ok($$
  select public.life_land_shop('2027-04-05', '[]', '{"shop": {"deliveredOn": "2027-04-05"}}')
$$, 'P0002', 'Plan the week first.', 'and so is a week with no plan');

-- A save that fails half-way leaves everything as it was
select throws_ok(format($$
  select public.life_land_shop('2027-03-01',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": 500}]}]',
    jsonb_build_object('shop', jsonb_build_object('deliveredOn', '2027-03-01'), 'pad', %L))
$$, repeat('x', 140000)), '23514', null, 'Given the plan breaks a constraint after the stock steps, then the call fails');
select is(pg_temp.stock('example-oats'), 600.00, 'and the stock is exactly as before');
select is(pg_temp.plan('2027-03-01'), '{"shop": {"ticked": ["example-oats"]}}'::jsonb, 'and so is the plan');
select throws_ok($$
  select public.life_land_shop('2027-03-01',
    '[{"mode": "add", "changes": [{"item": "example-oats", "qty": 500}]}, {"mode": "add", "changes": [{"item": "Not An Item", "qty": 1}]}]',
    '{"shop": {"deliveredOn": "2027-03-01"}}')
$$, '23514', null, 'Given a later stock step breaks a constraint, then the call fails');
select is(pg_temp.stock('example-oats'), 600.00, 'and the earlier step is undone too');
select is(pg_temp.plan('2027-03-01')->'shop'->>'deliveredOn', null, 'and the shop is still not in');

-- Who may call it
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.life_land_shop('2027-03-01', '[]', '{"shop": {"deliveredOn": "2027-03-01"}}') $$, '42501', null, 'anon is refused');
select lives_ok($$
  select public.life_land_shop('2027-03-01', '[]', '{"shop": {"deliveredOn": "2027-03-01"}}', null, encode(sha256('land-live'), 'hex'))
$$, 'a live connector token lands a shop');

reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.life_land_shop('2027-03-08', '[]', '{"trips": []}', 't1') $$, '42501', null, 'a mentor is refused');

select * from finish();
rollback;
