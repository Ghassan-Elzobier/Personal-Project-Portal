-- Suite: Life to-dos (20261125134804_life_todos.sql)
--
-- Only the owner adds, reads, ticks, moves, renames or removes a to-do, from a
-- session or a live connector token. Mentors, anon and expired tokens get
-- nothing, the table stays closed to the API roles, and no to-do ever shows up
-- among the tasks that mentors read.

begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

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
  ('owner', pg_temp.make_user('todo-owner@test.local')::text),
  ('mentor', pg_temp.make_user('todo-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
select (select v::uuid from fx where k = 'mentor'), k from unnest(enum_range(null::portal.project_key)) k;
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('todo-live'), 'hex'), now() + interval '1 hour', encode(sha256('todo-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('todo-expired'), 'hex'), now() - interval '1 minute', encode(sha256('todo-expired-refresh'), 'hex'), now() + interval '1 day');

-- One to-do as the owner reads it back, or null when it is not in the list.
create function pg_temp.todo(p_key text, p_done_since timestamptz default null)
returns jsonb
language sql
as $$
  select t from jsonb_array_elements(public.life_read_todos(p_done_since)) t where t->>'gid' = (select v from fx where k = p_key);
$$;

-- The owner
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

insert into fx values ('trial', (select public.life_add_todo('  Cancel the example trial  ', '2026-12-24')->>'gid'));
select is(pg_temp.todo('trial')->>'title', 'Cancel the example trial', 'Given the owner adds a to-do, then it is saved without the spaces around it');
select is(pg_temp.todo('trial')->>'due_on', '2026-12-24', 'and with its day');
select is(pg_temp.todo('trial')->>'done_at', null, 'and is open');
insert into fx values ('someday', (select public.life_add_todo('Example errand')->>'gid'));
select is(pg_temp.todo('someday')->>'due_on', null, 'a to-do can have no day');
select is(jsonb_array_length(public.life_read_todos()), 2, 'both are read back');

select throws_ok($$ select public.life_add_todo('   ') $$, '23514', null, 'a blank title is refused');
select throws_ok($$ select public.life_add_todo(repeat('x', 201)) $$, '23514', null, 'and so is one over 200 characters');
select lives_ok($$ select public.life_add_todo(repeat('x', 200)) $$, 'but 200 characters is fine');

select is(public.life_set_todo((select v::bigint from fx where k = 'trial'), '{"done": true}')->>'title', 'Cancel the example trial', 'When the owner ticks a to-do off, then the saved to-do comes back');
select isnt(pg_temp.todo('trial', now() - interval '1 hour')->>'done_at', null, 'it is done');
select is(pg_temp.todo('trial'), null, 'and drops out of the open list');
select is(public.life_set_todo((select v::bigint from fx where k = 'trial'), '{"done": false}')->>'done_at', null, 'unticking puts it back');
select isnt(pg_temp.todo('trial'), null, 'in the open list');

select is(public.life_set_todo((select v::bigint from fx where k = 'trial'), '{"due_on": "2026-12-23"}')->>'due_on', '2026-12-23', 'a to-do moves to another day');
select is(pg_temp.todo('trial')->>'title', 'Cancel the example trial', 'and keeps its title');
select is(public.life_set_todo((select v::bigint from fx where k = 'trial'), '{"due_on": null}')->>'due_on', null, 'its day can be cleared');
select is(public.life_set_todo((select v::bigint from fx where k = 'trial'), '{"title": "Cancel it", "due_on": "2026-12-24"}')->>'title', 'Cancel it', 'and it can be renamed');
select throws_ok(format($$ select public.life_set_todo(%s, '{"title": " "}') $$, (select v from fx where k = 'trial')), '23514', null, 'but not to nothing');
select throws_ok(format($$ select public.life_set_todo(%s, '{"project": "pmpp"}') $$, (select v from fx where k = 'trial')), '22023', null, 'a change it does not know is refused');
select throws_ok(format($$ select public.life_set_todo(%s, '{"done": "yes"}') $$, (select v from fx where k = 'trial')), '22023', null, 'done is true or false');
select throws_ok($$ select public.life_set_todo(-1, '{"done": true}') $$, 'P0002', null, 'a to-do that is not there says so');

-- No to-do is ever a task: the tasks mentors read never mention one.
select is(position('Cancel it' in public.tracker_snapshot()::text), 0, 'no to-do shows up among the tasks');

select is(public.life_remove_todo((select v::bigint from fx where k = 'someday'))->>'title', 'Example errand', 'removing a to-do returns it');
select is(pg_temp.todo('someday', now() - interval '1 day'), null, 'and it is gone, done or not');
select throws_ok($$ select public.life_remove_todo((select v::bigint from fx where k = 'someday')) $$, 'P0002', null, 'removing it twice says it is gone');

-- A live connector token works, an expired one does not, and anon gets nothing.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(public.life_add_todo('Example from Claude', '2026-12-01', encode(sha256('todo-live'), 'hex'))->>'title', 'Example from Claude', 'a live connector token adds a to-do');
select throws_ok($$ select public.life_read_todos(null, encode(sha256('todo-expired'), 'hex')) $$, '42501', null, 'an expired token reads nothing');
select throws_ok($$ select public.life_add_todo('x', null, encode(sha256('todo-expired'), 'hex')) $$, '42501', null, 'and adds nothing');
select throws_ok($$ select public.life_read_todos() $$, '42501', null, 'anon reads nothing');

-- A mentor, even one who sees every project, gets nothing.
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.life_read_todos() $$, '42501', null, 'a mentor reads no to-dos');
select throws_ok($$ select public.life_add_todo('x') $$, '42501', null, 'adds none');
select throws_ok(format($$ select public.life_set_todo(%s, '{"done": true}') $$, (select v from fx where k = 'trial')), '42501', null, 'ticks none off');
select throws_ok(format($$ select public.life_remove_todo(%s) $$, (select v from fx where k = 'trial')), '42501', null, 'removes none');
select throws_ok($$ select * from portal.life_todos $$, '42501', null, 'and cannot reach the table');
select is(position('Cancel it' in public.tracker_snapshot()::text), 0, 'nor see one among the tasks');

select * from finish();
rollback;
