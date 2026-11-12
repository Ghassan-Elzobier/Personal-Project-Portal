-- Suite: Life (meals, kitchen, gym, body)
--
-- Only the owner reads or writes any of it, from a session or a live connector
-- token. Mentors, anon and expired tokens get nothing, and the tables stay closed
-- to the API roles. Eating from a batch takes a portion and undoing gives it back;
-- a cook takes ingredients out of stock and undoing puts them back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

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
  ('owner', pg_temp.make_user('life-owner@test.local')::text),
  ('mentor', pg_temp.make_user('life-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('life-live'), 'hex'), now() + interval '1 hour', encode(sha256('life-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('life-expired'), 'hex'), now() - interval '1 minute', encode(sha256('life-expired-refresh'), 'hex'), now() + interval '1 day');

-- Reads go through life_read, as the app's do: the tables are closed to the API roles.
create function pg_temp.stock(p_item text)
returns numeric
language sql
as $$
  select (s->>'qty')::numeric from jsonb_array_elements(public.life_read('2026-11-01')->'stock') s where s->>'item' = p_item;
$$;

create function pg_temp.remaining()
returns integer
language sql
as $$
  select (b->>'remaining')::integer from jsonb_array_elements(public.life_read('2026-11-01')->'batches') b where b->>'gid' = (select v from fx where k = 'batch');
$$;

-- The owner
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

select lives_ok($$ select public.life_save_profile('{"activity": 1.55}'::jsonb) $$, 'the owner saves a profile');
select lives_ok($$ select public.life_log_weight('2026-11-13', 65.4) $$, 'and logs a weigh-in');
select lives_ok($$ select public.life_log_weight('2026-11-13', 65.6) $$, 'a second weigh-in that day replaces the first');
select is((public.life_read('2026-11-01')->'weights'->0->>'kg')::numeric, 65.6, 'reads it back');
select throws_ok($$ select public.life_log_weight('2026-11-14', 20) $$, '23514', null, 'an impossible weight is refused');

select lives_ok($$ select public.life_stock('[{"item": "beef-mince", "qty": 1000}]'::jsonb, 'add') $$, 'a delivery adds stock');
insert into fx values ('batch', (select public.life_cook('bolognese', '2026-11-15', 6, 1, 2, '[{"item": "beef-mince", "qty": 750}]'::jsonb, '2026-11-15', 'c1')));
select is(pg_temp.stock('beef-mince'), 250.00, 'a cook takes its ingredients out of stock');
select is(jsonb_array_length(public.life_read('2026-11-01')->'batches'), 2, 'four portions go in the fridge and two in the freezer');
select throws_ok($$ select public.life_cook('bolognese', '2026-11-15', 4, 1, 0, '[]'::jsonb, '2026-11-15', 'c1') $$, '22023', null, 'a planned cook is logged once');

select lives_ok($$ select public.life_log_meal('2026-11-16', 'lunch', 'eaten', 'bolognese', (select v::bigint from fx where k = 'batch'), 850, 50) $$, 'eating from a batch');
select is(pg_temp.remaining(), 3, 'takes a portion');
select lives_ok($$ select public.life_log_meal('2026-11-16', 'lunch', 'skipped') $$, 'changing it to skipped');
select is(pg_temp.remaining(), 4, 'gives the portion back');

select lives_ok($$ select public.life_uncook((select v::bigint from fx where k = 'batch')) $$, 'undoing the cook');
select is(pg_temp.stock('beef-mince'), 1000.00, 'puts the ingredients back once');
select is(jsonb_array_length(public.life_read('2026-11-01')->'batches'), 0, 'and removes both batches');

select throws_ok($$ select public.life_save_product('chicken-thigh', 'https://evil.example/gol-ui/product/x', 'X', 1000, 'g') $$, '23514', null, 'only Sainsbury''s product links are stored');

select lives_ok($$ select public.gym_log_set('2026-11-13', 'A', 'bench', 1, 60, 5, 2) $$, 'a set starts the day''s session');
select lives_ok($$ select public.gym_session('2026-11-13', 'A', true, 4, 'Felt strong') $$, 'and the session finishes');
select is((public.life_read('2026-11-01')->'sessions'->0->>'finished')::boolean, true, 'reads back as finished');

-- A live connector token works, an expired one does not.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select lives_ok($$ select public.life_log_weight('2026-11-14', 65.8, encode(sha256('life-live'), 'hex')) $$, 'a live connector token logs a weigh-in');
select throws_ok($$ select public.life_read('2026-11-01', encode(sha256('life-expired'), 'hex')) $$, '42501', null, 'an expired token reads nothing');
select throws_ok($$ select public.life_read('2026-11-01') $$, '42501', null, 'anon reads nothing');

-- A mentor
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.life_read('2026-11-01') $$, '42501', null, 'a mentor reads nothing');
select throws_ok($$ select * from portal.body_weights $$, '42501', null, 'and cannot reach the tables');

select * from finish();
rollback;
