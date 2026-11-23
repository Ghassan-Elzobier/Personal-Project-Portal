-- Suite: Money, part 10: where a pay rise goes
--
-- The owner saves the share of a rise that goes to goals, and the day it is measured
-- from; the budget read returns both. A share outside 0 to 10000 is refused.

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
insert into fx values ('owner', pg_temp.make_user('money-raise-owner@test.local')::text);
insert into portal.members (account_id, role, display_name) values ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

select is(
  public.money_budget('2026-11-01', '2026-11-16')->'settings'->'raise_goal_share_bp',
  'null'::jsonb,
  'Given nothing chosen, when the budget is read, then the share of a rise is null: not asked yet'
);

select public.money_save_settings('{"raise_goal_share_bp": 5000, "raise_since": "2026-11-16"}'::jsonb);
select is(
  public.money_budget('2026-11-01', '2026-11-16')->'settings'->>'raise_goal_share_bp',
  '5000',
  'Given the owner picks half, when the budget is read, then the share is 5000 basis points'
);
select is(
  public.money_budget('2026-11-01', '2026-11-16')->'settings'->>'raise_since',
  '2026-11-16',
  'Given the owner picks a share, when the budget is read, then the day it is measured from comes back'
);

select throws_ok(
  $$ select public.money_save_settings('{"raise_goal_share_bp": 10001}'::jsonb) $$,
  '23514',
  null,
  'Given a share over 10000, when it is saved, then the database refuses it'
);
select throws_ok(
  $$ select public.money_save_settings('{"raise_goal_share_bp": -1}'::jsonb) $$,
  '23514',
  null,
  'Given a share under 0, when it is saved, then the database refuses it'
);

select * from finish();
rollback;
