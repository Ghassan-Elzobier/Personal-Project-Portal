-- Suite: assisted gym sets (20261126151739_gym_assisted_load.sql)
--
-- An assisted pull-up or dip machine takes weight off, so its help is logged as
-- negative kg. The weight check now goes below zero, and still refuses a weight
-- or an amount of help no one could use.

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

create temp table fx (k text primary key, v text) on commit drop;
grant select on fx to authenticated;
insert into fx values ('owner', pg_temp.make_user('assisted-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');

-- Reads go through life_read, as the app's do.
create function pg_temp.kg(p_exercise text, p_position integer)
returns numeric
language sql
as $$
  select (s->>'kg')::numeric
  from jsonb_array_elements(public.life_read('2026-11-01')->'sets') s
  where s->>'exercise' = p_exercise and (s->>'position')::integer = p_position;
$$;

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

select lives_ok(
  $$ select public.gym_log_set('2026-11-13', 'B', 'pull-up', 1, -35, 8, 2) $$,
  'Given an assisted pull-up, when the owner logs 35 kg of help as -35, it saves'
);
select is(pg_temp.kg('pull-up', 1), -35.00, 'then it reads back as -35');
select lives_ok(
  $$ select public.gym_log_set('2026-11-13', 'B', 'pull-up', 2, 2.5, 6, 1) $$,
  'weight on a belt still saves as a positive number'
);
select throws_ok(
  $$ select public.gym_log_set('2026-11-13', 'B', 'pull-up', 3, -250, 8, 2) $$,
  '23514', null, 'more help than any machine gives is refused'
);
select throws_ok(
  $$ select public.gym_log_set('2026-11-13', 'B', 'bench', 1, 600, 5, 2) $$,
  '23514', null, 'and so is an impossible weight'
);

select * from finish();
rollback;
