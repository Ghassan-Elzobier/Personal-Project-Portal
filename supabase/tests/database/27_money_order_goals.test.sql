-- Suite: Money, goals put in order in one go
--
-- The owner sends every goal not done, first first, and the budget lists them so.
-- A list that leaves one out or names one twice is refused, and nobody but the
-- owner may reorder.

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

create function pg_temp.names()
returns jsonb
language sql
as $$
  select jsonb_agg(g->>'name')
  from jsonb_array_elements(public.money_budget(date_trunc('month', current_date)::date, current_date)->'goals') g;
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('money-order-owner@test.local')::text),
  ('mentor', pg_temp.make_user('money-order-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');

delete from portal.money_goals;
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select public.money_connect('[{"uid": "acc-1", "name": "Current account", "kind": "current", "last4": "1234"}]'::jsonb);
insert into fx values
  ('fund', public.money_save_goal('{"name": "Emergency fund", "kind": "saving", "target_pence": 300000}'::jsonb)::text),
  ('card', public.money_save_goal('{"name": "Example card", "kind": "debt", "saved_pence": 90000, "apr_bp": 2490}'::jsonb)::text),
  ('loan', public.money_save_goal('{"name": "Example loan", "kind": "debt", "saved_pence": 40000, "apr_bp": 600}'::jsonb)::text);

select public.money_order_goals(array[(select v::bigint from fx where k = 'fund'), (select v::bigint from fx where k = 'loan'),
                                      (select v::bigint from fx where k = 'card')]);
select is(pg_temp.names(), '["Emergency fund", "Example loan", "Example card"]'::jsonb,
  'Given three goals, when the owner sends a new order, then the budget lists them in it');

select throws_ok(format('select public.money_order_goals(array[%s, %s])', (select v from fx where k = 'fund'),
                        (select v from fx where k = 'card')), '22023', null,
  'When the order leaves a goal out, then it is refused');
select throws_ok(format('select public.money_order_goals(array[%1$s, %1$s, %2$s])', (select v from fx where k = 'fund'),
                        (select v from fx where k = 'card')), '22023', null,
  'When the order names a goal twice, then it is refused');
select is(pg_temp.names(), '["Emergency fund", "Example loan", "Example card"]'::jsonb,
  'Then a refused order changes nothing');

select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok(format('select public.money_order_goals(array[%s, %s, %s])', (select v from fx where k = 'card'),
                        (select v from fx where k = 'loan'), (select v from fx where k = 'fund')), null, null,
  'When a mentor tries to reorder the goals, then it is refused');

select * from finish();
rollback;
