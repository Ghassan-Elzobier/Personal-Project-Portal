-- Suite: Money, part 10 (the Monday check-in)
--
-- The owner's check-in records the choice; "goal" takes the overspend from a goal kept
-- in the account (never below nothing), "week" lowers this week's fixed amount only when
-- the engine fixed it for the week after the one checked in on. Nobody else may.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

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
insert into fx values ('owner', pg_temp.make_user('money10-owner@test.local')::text),
                      ('stranger', pg_temp.make_user('money10-stranger@test.local')::text);
insert into portal.members (account_id, role, display_name) values ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner');

-- Last week and this week, by their Mondays (made-up dates).
insert into fx values ('last', '2026-11-09'), ('this', '2026-11-16');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
insert into fx values ('fund', public.money_save_goal(
  '{"name": "Example fund", "kind": "saving", "target_pence": 100000, "held": "account", "saved_pence": 2000}'::jsonb)::text);
insert into fx values ('saver', public.money_save_goal(
  '{"name": "Example saver", "kind": "saving", "target_pence": 100000, "held": "elsewhere", "saved_pence": 50000}'::jsonb)::text);
reset role;

-- Anyone other than the owner is refused.
select pg_temp.act_as((select v::uuid from fx where k = 'stranger'));
select throws_ok(format($$ select public.money_check_in(%L, 'keep') $$, (select v from fx where k = 'last')), '42501', null,
  'Given someone who is not the owner, when they check in, then they are refused');
reset role;
set local role anon;
select throws_ok(format($$ select public.money_check_in(%L, 'keep') $$, (select v from fx where k = 'last')), '42501', null,
  'and so is a caller who is not signed in');
reset role;

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select throws_ok(format($$ select public.money_check_in(%L, 'spend') $$, (select v from fx where k = 'last')), '22023', null,
  'A choice the card never offers is refused');
select throws_ok(format($$ select public.money_check_in(%L, 'goal', %s, 1000) $$,
  (select v from fx where k = 'last'), (select v from fx where k = 'saver')), 'P0001', null,
  'A goal kept elsewhere cannot cover an overspend');

-- Covering it from a goal.
select public.money_check_in((select v::date from fx where k = 'last'), 'goal', (select v::bigint from fx where k = 'fund'), 1500);
reset role;
select is((select saved_pence from portal.money_goals where id = (select v::bigint from fx where k = 'fund')), 500::bigint,
  'When the owner covers £15 from a goal holding £20, then the goal holds £5');
select is((select checkin_week from portal.money_settings where id), '2026-11-09'::date, 'and the week is checked in');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(public.money_budget('2026-11-01', '2026-11-16')->'checkin'->>'choice', 'goal',
  'and the budget''s numbers carry the choice');
select public.money_check_in((select v::date from fx where k = 'last'), 'goal', (select v::bigint from fx where k = 'fund'), 9000);
reset role;
select is((select saved_pence from portal.money_goals where id = (select v::bigint from fx where k = 'fund')), 0::bigint,
  'A goal never goes below nothing');

-- Taking it off this week: only this week's amount, as the engine fixed it.
update portal.money_settings set week_amount_of = '2026-11-16', week_amount_pence = 14000 where id;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_check_in('2026-11-02', 'week', null, 3000);
reset role;
select is((select week_amount_pence from portal.money_settings where id), 14000::bigint,
  'When the week checked in on is not the one before this week''s amount, then the amount stays');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_check_in((select v::date from fx where k = 'last'), 'week', null, 3000);
reset role;
select is((select week_amount_pence from portal.money_settings where id), 11000::bigint,
  'When it is, then this week''s amount drops by the overspend');

-- Erasing the bank data forgets the check-in.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_forget_all();
reset role;
select is((select checkin_week from portal.money_settings where id), null::date,
  'Erasing all bank data forgets the check-in');

select * from finish();
rollback;
