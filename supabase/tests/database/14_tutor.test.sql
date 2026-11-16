-- Suite: Tutor (sessions, answers, the knowledge graph, reviews)
--
-- Only the owner reads or writes any of it, from a session or a live connector
-- token. Mentors, anon and expired tokens get nothing, and the tables stay closed
-- to the API roles. A claim or chain taught twice is one row; ending a session on
-- a unit adds reviews to its recall queue, and one with no unit adds none.

begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

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
  ('owner', pg_temp.make_user('tutor-owner@test.local')::text),
  ('mentor', pg_temp.make_user('tutor-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('tutor-live'), 'hex'), now() + interval '1 hour', encode(sha256('tutor-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v::uuid from fx where k = 'owner'), 'test', encode(sha256('tutor-expired'), 'hex'), now() - interval '1 minute', encode(sha256('tutor-expired-refresh'), 'hex'), now() + interval '1 day');

-- A unit to teach: a task in a project, made as the table owner.
insert into portal.sections (project, name) values ('pmpp', 'Tutor test');
insert into portal.tasks (project, section_gid, ref, name)
  select 'pmpp', gid, 'pmpp-test', 'A test unit' from portal.sections where name = 'Tutor test';
insert into fx select 'task', gid::text from portal.tasks where ref = 'pmpp-test';

-- The owner
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));

insert into fx values ('s1', (select public.tutor_start_session('teach', (select v::bigint from fx where k = 'task'), 'Tiling a matrix multiply')::text));
select ok((select v from fx where k = 's1') is not null, 'the owner starts a session on a unit');
select throws_ok($$ select public.tutor_start_session('lecture', null, 'x') $$, '23514', null, 'an unknown kind of session is refused');
select throws_ok($$ select public.tutor_start_session('teach', 999999999, 'x') $$, 'P0002', null, 'a session on a missing task is refused');

select is(public.tutor_set_plan((select v::bigint from fx where k = 's1'), '{"nodes": [{"id": "a", "label": "Memory", "status": "next"}], "edges": []}'::jsonb), 1, 'the first plan is revision 1');
select is(public.tutor_set_plan((select v::bigint from fx where k = 's1'), '{"nodes": [{"id": "a", "label": "Memory", "status": "done"}], "edges": []}'::jsonb), 2, 'changing it makes revision 2');

select lives_ok($$ select public.tutor_record_answer((select v::bigint from fx where k = 's1'), 'check', 'Why tile?', 'Reuse', false, false, 90, 'because bandwidth', 'Close: reuse from shared memory', null) $$, 'a wrong answer given with high confidence is saved');
select lives_ok($$ select public.tutor_record_answer((select v::bigint from fx where k = 's1'), 'probe', 'What is a warp?', '', true, null, 80, '', '', null) $$, 'a don''t know is saved');
select is((public.tutor_read((select v::bigint from fx where k = 's1'), null)->'answers'->1->>'confidence'), null, 'and keeps no confidence');
select throws_ok($$ select public.tutor_record_answer((select v::bigint from fx where k = 's1'), 'check', 'Q', 'A', false, true, 150, '', '', null) $$, '23514', null, 'a confidence over 100 is refused');

insert into fx values ('keys', (public.tutor_save_claims((select v::bigint from fx where k = 's1'),
    '[{"key": "a", "name": "Reuse", "statement": "Tiles are reused by every thread in a block."}, {"key": "b", "name": "Bandwidth", "statement": "Global memory bandwidth limits the kernel."}, {"key": "c", "name": "Tiling", "statement": "Loading a tile once cuts global reads."}]'::jsonb,
    '[{"premises": ["a", "b"], "conclusion": "c"}]'::jsonb))::text);
select is((select count(*)::integer from jsonb_object_keys((select v::jsonb from fx where k = 'keys'))), 3, 'claims and a chain are saved, returning their keys');
select is(jsonb_array_length(public.tutor_read(null, null)->'claims'), 3, 'three claims exist');

-- Later batches name earlier claims by gid; keys only mean something inside one batch.
select lives_ok(format($$ select public.tutor_save_claims((select v::bigint from fx where k = 's1'),
  '[{"key": "z", "name": "Reuse again", "statement": "TILES ARE REUSED BY EVERY THREAD IN A BLOCK."}]'::jsonb,
  '[{"premises": ["%1$s", "z"], "conclusion": "%2$s"}, {"premises": ["z", "%1$s"], "conclusion": "%2$s"}]'::jsonb) $$,
  (select v::jsonb ->> 'b' from fx where k = 'keys'), (select v::jsonb ->> 'c' from fx where k = 'keys')),
  'the same claim again, and a chain listed in another order');
select is(jsonb_array_length(public.tutor_read(null, null)->'claims'), 3, 'is still three claims');
select is(jsonb_array_length(public.tutor_read(null, null)->'chains'), 1, 'and one chain');
select throws_ok($$ select public.tutor_save_claims((select v::bigint from fx where k = 's1'), '[]'::jsonb, '[{"premises": ["nope"], "conclusion": "nope"}]'::jsonb) $$, '22023', null, 'a chain naming a claim that was never saved is refused');

select is(public.tutor_end_session((select v::bigint from fx where k = 's1'), 'done', 'Tiling clicked.',
  '[{"prompt": "Why does tiling cut global reads?", "days": 3}, {"prompt": "Explain tile reuse.", "days": 1}]'::jsonb), 2, 'ending a session on a unit adds its reviews');
select is((select count(*)::integer from jsonb_array_elements(public.tracker_study_snapshot()->'reviews') r where r->>'task_gid' = (select v from fx where k = 'task')), 2, 'they are in the unit''s recall queue');
select throws_ok($$ select public.tutor_record_answer((select v::bigint from fx where k = 's1'), 'check', 'Q', 'A', false, true, 50, '', '', null) $$, '22023', null, 'a closed session takes no more answers');

insert into fx values ('s2', (select public.tutor_start_session('practice', null, 'Free practice')::text));
select is(public.tutor_end_session((select v::bigint from fx where k = 's2'), 'done', '', '[{"prompt": "Orphan review", "days": 1}]'::jsonb), 0, 'a session with no unit adds no reviews');

select is((public.tutor_read(null, null)->'sessions'->1->>'confident_misses')::integer, 1, 'the first session shows its one confident miss');
select is(jsonb_array_length(public.tutor_read(null, array[(select v::bigint from fx where k = 'task')])->'sessions'), 1, 'sessions can be read for one unit');

-- A live connector token works, an expired one does not.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select lives_ok($$ select public.tutor_start_session('teach', null, 'From the connector', encode(sha256('tutor-live'), 'hex')) $$, 'a live connector token starts a session');
select throws_ok($$ select public.tutor_read(null, null, encode(sha256('tutor-expired'), 'hex')) $$, '42501', null, 'an expired token reads nothing');
select throws_ok($$ select public.tutor_read(null, null) $$, '42501', null, 'anon reads nothing');

-- A mentor
reset role;
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok($$ select public.tutor_read(null, null) $$, '42501', null, 'a mentor reads nothing');
select throws_ok($$ select * from portal.tutor_claims $$, '42501', null, 'and cannot reach the tables');

select * from finish();
rollback;
