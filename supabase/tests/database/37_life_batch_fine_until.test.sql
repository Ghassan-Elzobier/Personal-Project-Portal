-- Suite: "Still fine until" on a fridge batch (20261127220120_life_batch_fine_until.sql)
--
-- The owner can say one fridge batch is still fine past its eat-by. The day is
-- stored on the batch, read back through life_read, cleared with null, kept within
-- a week of cooking, refused for the freezer, and only the owner can set it.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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
grant select on fx to authenticated;
insert into fx values ('owner', pg_temp.make_user('fine-until-owner@test.local')::text);
insert into fx values ('mentor', pg_temp.make_user('fine-until-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
with b as (
  insert into portal.meal_batches (recipe, cooked_on, portions, remaining, location)
  values ('example-stew', '2026-11-20', 4, 2, 'fridge') returning gid
)
insert into fx select 'fridge', gid::text from b;
with b as (
  insert into portal.meal_batches (recipe, cooked_on, portions, remaining, location)
  values ('example-stew', '2026-11-20', 4, 2, 'freezer') returning gid
)
insert into fx select 'freezer', gid::text from b;

-- Reads go through life_read, as the app's do.
create function pg_temp.fine_until(p_gid text)
returns text
language sql
as $$
  select b->>'fine_until'
  from jsonb_array_elements(public.life_read('2026-11-20')->'batches') b
  where b->>'gid' = p_gid;
$$;

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

select is(pg_temp.fine_until((select v from fx where k = 'fridge')), null, 'Given a fridge batch, it starts with no day set');
select lives_ok(
  $$ select public.life_set_batch_fine_until((select v::bigint from fx where k = 'fridge'), '2026-11-23') $$,
  'when the owner says it is still fine until a later day, it saves'
);
select is(pg_temp.fine_until((select v from fx where k = 'fridge')), '2026-11-23', 'then life_read returns that day');
select lives_ok(
  $$ select public.life_set_batch_fine_until((select v::bigint from fx where k = 'fridge'), null) $$,
  'clearing it saves'
);
select is(pg_temp.fine_until((select v from fx where k = 'fridge')), null, 'and the batch is back to the rule');
select throws_ok(
  $$ select public.life_set_batch_fine_until((select v::bigint from fx where k = 'fridge'), '2026-11-28') $$,
  '22023', null, 'more than a week after cooking is refused'
);
select throws_ok(
  $$ select public.life_set_batch_fine_until((select v::bigint from fx where k = 'freezer'), '2026-11-22') $$,
  '22023', null, 'food in the freezer has no eat-by to change'
);
select throws_ok(
  $$ select public.life_set_batch_fine_until(999999999, '2026-11-22') $$,
  'P0002', null, 'a batch that is gone is refused'
);

select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok(
  $$ select public.life_set_batch_fine_until((select v::bigint from fx where k = 'fridge'), '2026-11-22') $$,
  '42501', null, 'a mentor cannot set it'
);

select * from finish();
rollback;
