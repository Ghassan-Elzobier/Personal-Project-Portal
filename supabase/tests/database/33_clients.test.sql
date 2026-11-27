-- Suite: Clients (20261127091600_clients.sql)
--
-- Only the owner adds, reads, changes or removes clients, their projects and
-- milestones, from a session or a live connector token. Mentors, anon and expired
-- tokens get nothing, the tables stay closed to the API roles, and no client ever
-- shows up among the tasks that mentors read.

begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

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
  ('owner', pg_temp.make_user('clients-owner@test.local')::text),
  ('mentor', pg_temp.make_user('clients-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mentor_projects (account_id, project)
select (select v::uuid from fx where k = 'mentor'), k from unnest(enum_range(null::portal.project_key)) k;
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('clients-live'), 'hex'), now() + interval '1 hour', encode(sha256('clients-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('clients-expired'), 'hex'), now() - interval '1 minute', encode(sha256('clients-expired-refresh'), 'hex'), now() + interval '1 day');

-- One record as the owner reads it back (p_list is clients, projects or
-- milestones), or null when it is not there.
create function pg_temp.rec(p_list text, p_key text)
returns jsonb
language sql
as $$
  select r from jsonb_array_elements(public.clients_read() -> p_list) r where r->>'gid' = (select v from fx where k = p_key);
$$;

-- The owner: clients
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

insert into fx values ('acme', (select public.clients_add_client('  Example Client  ', 'friend', 'Email')->>'gid'));
select is(pg_temp.rec('clients', 'acme')->>'name', 'Example Client', 'Given the owner adds a client, then it is saved without the spaces around it');
select is(pg_temp.rec('clients', 'acme')->>'relationship', 'friend', 'with how the owner knows them');
insert into fx values ('other', (select public.clients_add_client('Another Example')->>'gid'));
select is(pg_temp.rec('clients', 'other')->>'relationship', 'referral', 'a client is a referral unless said otherwise');
select throws_ok($$ select public.clients_add_client('   ') $$, '23514', null, 'a blank name is refused');
select throws_ok($$ select public.clients_add_client('Example', 'cousin') $$, '23514', null, 'and so is a relationship it does not know');

select is(public.clients_set_client((select v::bigint from fx where k = 'acme'), '{"time_zone": "Europe/Paris", "notes": "Prefers calls"}')->>'time_zone', 'Europe/Paris', 'When the owner changes a client, then the change is saved');
select is(public.clients_set_client((select v::bigint from fx where k = 'acme'), '{"notes": "  "}')->>'notes', null, 'and blank notes clear them');
select throws_ok(format($$ select public.clients_set_client(%s, '{"email": "x@example.test"}') $$, (select v from fx where k = 'acme')), '22023', null, 'a field a client does not have is refused');

-- The owner: projects
insert into fx values ('app', (select public.clients_add_project((select v::bigint from fx where k = 'acme'), '  Example app  ')->>'gid'));
select is(pg_temp.rec('projects', 'app')->>'title', 'Example app', 'Given the owner adds a project for a client, then it is saved, trimmed');
select is(pg_temp.rec('projects', 'app')->>'stage', 'lead', 'it starts as a lead');
select is(pg_temp.rec('projects', 'app')->>'pricing', 'fixed', 'at a fixed price unless said otherwise');
select is(pg_temp.rec('projects', 'app')->>'client_gid', (select v from fx where k = 'acme'), 'and belongs to its client');
select throws_ok($$ select public.clients_add_project(-1, 'Example') $$, 'P0002', null, 'a project for a client that is not there says so');

select is(public.clients_set_project((select v::bigint from fx where k = 'app'), '{"stage": "building", "pricing": "day_rate"}')->>'stage', 'building', 'When the owner moves a project on, then its stage is saved');
select is(pg_temp.rec('projects', 'app')->>'pricing', 'day_rate', 'with its pricing');
select throws_ok(format($$ select public.clients_set_project(%s, '{"stage": "dreaming"}') $$, (select v from fx where k = 'app')), '23514', null, 'a stage it does not know is refused');
select throws_ok(format($$ select public.clients_set_project(%s, '{"title": 5}') $$, (select v from fx where k = 'app')), '22023', null, 'a title that is not text is refused');
select is(public.clients_set_project((select v::bigint from fx where k = 'app'), '{"repo_url": "https://example.test/repo"}')->>'repo_url', 'https://example.test/repo', 'a project keeps its repo link');
select throws_ok(format($$ select public.clients_set_project(%s, '{"live_url": "http://example.test"}') $$, (select v from fx where k = 'app')), '23514', null, 'but only an https link');
select is(public.clients_set_project((select v::bigint from fx where k = 'app'), '{"repo_url": null}')->>'repo_url', null, 'and null clears a link');

-- The owner: milestones
insert into fx values ('m1', (select public.clients_add_milestone((select v::bigint from fx where k = 'app'), 'Example first part', '2026-12-18', 150000)->>'gid'));
select is((pg_temp.rec('milestones', 'm1')->>'amount_pence')::int, 150000, 'Given the owner adds a milestone, then its amount is saved in pence');
select is(pg_temp.rec('milestones', 'm1')->>'due_on', '2026-12-18', 'with the day it is due');
select throws_ok($$ select public.clients_add_milestone(-1, 'Example') $$, 'P0002', null, 'a milestone for a project that is not there says so');
select throws_ok(format($$ select public.clients_add_milestone(%s, 'Example', null, -1) $$, (select v from fx where k = 'app')), '23514', null, 'a negative amount is refused');
select is(public.clients_set_milestone((select v::bigint from fx where k = 'm1'), '{"accepted_on": "2026-12-18"}')->>'accepted_on', '2026-12-18', 'When the client accepts a milestone, then the day is saved');
select is(public.clients_set_milestone((select v::bigint from fx where k = 'm1'), '{"paid_on": "2026-12-20"}')->>'paid_on', '2026-12-20', 'and so is the day it was paid');
select is(public.clients_set_milestone((select v::bigint from fx where k = 'm1'), '{"paid_on": null}')->>'paid_on', null, 'a payment can be taken back');
select throws_ok(format($$ select public.clients_set_milestone(%s, '{"amount_pence": "lots"}') $$, (select v from fx where k = 'm1')), '22023', null, 'an amount that is not a number is refused');
select is(jsonb_array_length(public.clients_read()->'milestones'), 1, 'the owner reads every milestone back');

-- The owner: removing
select is(public.clients_remove('milestone', (select v::bigint from fx where k = 'm1'))->>'title', 'Example first part', 'removing a milestone returns it');
select is(pg_temp.rec('milestones', 'm1'), null, 'and it is gone');
select throws_ok(format($$ select public.clients_remove('milestone', %s) $$, (select v from fx where k = 'm1')), 'P0002', null, 'removing it twice says it is gone');
select throws_ok(format($$ select public.clients_remove('invoice', %s) $$, (select v from fx where k = 'app')), '22023', null, 'a kind it does not know is refused');
insert into fx values ('m2', (select public.clients_add_milestone((select v::bigint from fx where k = 'app'), 'Example handover')->>'gid'));
select is(public.clients_remove('client', (select v::bigint from fx where k = 'acme'))->>'name', 'Example Client', 'removing a client returns it');
select is(pg_temp.rec('projects', 'app'), null, 'and takes its projects with it');
select is(pg_temp.rec('milestones', 'm2'), null, 'and their milestones');

-- No client is ever a task: the tasks mentors read never mention one.
select is(position('Another Example' in public.tracker_snapshot()::text), 0, 'no client shows up among the tasks');

-- A live connector token works, an expired one does not, and anon gets nothing.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(public.clients_add_client('Example from Claude', 'other', null, encode(sha256('clients-live'), 'hex'))->>'name', 'Example from Claude', 'a live connector token adds a client');
select throws_ok($$ select public.clients_read(encode(sha256('clients-expired'), 'hex')) $$, '42501', null, 'an expired token reads nothing');
select throws_ok($$ select public.clients_read() $$, '42501', null, 'anon reads nothing');

-- A mentor, even one who sees every project, gets nothing.
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.clients_read() $$, '42501', null, 'a mentor reads no clients');
select throws_ok($$ select public.clients_add_client('x') $$, '42501', null, 'adds none');
select throws_ok(format($$ select public.clients_set_client(%s, '{"name": "x"}') $$, (select v from fx where k = 'other')), '42501', null, 'changes none');
select throws_ok(format($$ select public.clients_remove('client', %s) $$, (select v from fx where k = 'other')), '42501', null, 'removes none');
select throws_ok($$ select * from portal.clients $$, '42501', null, 'and cannot reach the clients table');
select throws_ok($$ select * from portal.client_projects $$, '42501', null, 'the projects table');
select throws_ok($$ select * from portal.client_milestones $$, '42501', null, 'or the milestones table');
select is(position('Another Example' in public.tracker_snapshot()::text), 0, 'nor see a client among the tasks');

select * from finish();
rollback;
