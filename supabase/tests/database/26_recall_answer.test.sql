-- Suite: a recall card's answer
--
-- The tutor may give each review an answer when a session ends. It is saved with
-- the card, a review sent without one is saved as before, and a card that comes
-- back keeps its answer unless it is given a new one. The owner's study snapshot
-- says the answer; a mentor's, for the same shared project, never does.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

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

-- One of this suite's cards, as the caller's study snapshot shows it.
create function pg_temp.card(p_prompt text)
returns jsonb
language sql
as $$
  select r from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r where r ->> 'prompt' = p_prompt;
$$;

create temp table fx (k text primary key, v text) on commit drop;
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('recall-owner@test.local')::text),
  ('mentor', pg_temp.make_user('recall-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');
-- The mentor is shared the project the unit is in.
insert into portal.mentor_projects (account_id, project)
values ((select v::uuid from fx where k = 'mentor'), 'pmpp');

-- A unit to teach: a task in a project, made as the table owner.
insert into portal.sections (project, name) values ('pmpp', 'Recall test');
insert into portal.tasks (project, section_gid, ref, name)
  select 'pmpp', gid, 'recall-test', 'A unit for the recall test' from portal.sections where name = 'Recall test';
insert into fx select 'task', gid::text from portal.tasks where ref = 'recall-test';

select ok(
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'portal' and table_name = 'reviews' and column_name = 'answer'),
  'Given the reviews table, When its answer column is inspected, Then a card may have no answer');

-- The owner ends a lesson on the unit.
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
insert into fx values ('s1', (select public.tutor_start_session('teach', (select v::bigint from fx where k = 'task'), 'Tiling a matrix multiply')::text));

select is(
  public.tutor_end_session((select v::bigint from fx where k = 's1'), 'done', 'Tiling clicked.',
    '[{"prompt": "Why does tiling cut global reads?", "days": 3, "answer": "  A tile is loaded once and every thread in the block reuses it.  "},
      {"prompt": "Explain tile reuse.", "days": 1},
      {"prompt": "What limits the kernel?", "days": 1, "answer": "   "}]'::jsonb),
  3,
  'Given reviews with an answer, without one and with a blank one, When the session ends, Then all three are added');

select is(
  pg_temp.card('Why does tiling cut global reads?') ->> 'answer',
  'A tile is loaded once and every thread in the block reuses it.',
  'Given a review sent with an answer, When the owner reads the queue, Then the card says the answer, trimmed');

select ok(
  pg_temp.card('Explain tile reuse.') is not null and pg_temp.card('Explain tile reuse.') ->> 'answer' is null,
  'Given a review sent without an answer, When the owner reads the queue, Then the card is there with none');

select ok(
  pg_temp.card('What limits the kernel?') is not null and pg_temp.card('What limits the kernel?') ->> 'answer' is null,
  'Given a review sent with a blank answer, When the owner reads the queue, Then the card is there with none');

select is(
  (pg_temp.card('Why does tiling cut global reads?') ->> 'due_on')::date, current_date + 3,
  'Given a review with an answer, When it is saved, Then it is due as before');

-- The same questions come back from a later lesson.
insert into fx values ('s2', (select public.tutor_start_session('teach', (select v::bigint from fx where k = 'task'), 'Tiling again')::text));
select is(
  public.tutor_end_session((select v::bigint from fx where k = 's2'), 'done', '',
    '[{"prompt": "Why does tiling cut global reads?", "days": 2},
      {"prompt": "Explain tile reuse.", "days": 1, "answer": "Threads in a block share the tile in shared memory."}]'::jsonb),
  2,
  'Given cards that exist already, When a later session sends them again, Then both are taken');

select is(
  pg_temp.card('Why does tiling cut global reads?') ->> 'answer',
  'A tile is loaded once and every thread in the block reuses it.',
  'Given a card with an answer, When it comes back with none, Then it keeps the answer it had');

select is(
  pg_temp.card('Explain tile reuse.') ->> 'answer',
  'Threads in a block share the tile in shared memory.',
  'Given a card with no answer, When it comes back with one, Then it gains it');

select is(
  (select count(*)::integer from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r
    where r ->> 'task_gid' = (select v from fx where k = 'task')),
  3,
  'Given cards sent twice, When the queue is read, Then each is there once');

-- What an answer must be.
insert into fx values ('s3', (select public.tutor_start_session('teach', (select v::bigint from fx where k = 'task'), 'Too long')::text));
select throws_ok(
  format($$ select public.tutor_end_session(%s, 'done', '', jsonb_build_array(jsonb_build_object('prompt', 'Too long?', 'days', 1, 'answer', repeat('x', 1001)))) $$,
    (select v from fx where k = 's3')),
  '23514', null,
  'Given an answer of more than 1000 characters, When the session ends, Then it is refused');

select lives_ok(
  format($$ select public.tutor_end_session(%s, 'done', '', jsonb_build_array(jsonb_build_object('prompt', 'Just fits?', 'days', 1, 'answer', repeat('x', 1000)))) $$,
    (select v from fx where k = 's3')),
  'Given an answer of exactly 1000 characters, When the session ends, Then it is saved');

-- A mentor shared the same project reads the questions and never the answers.
select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));

select is(
  pg_temp.card('Why does tiling cut global reads?') ->> 'prompt', 'Why does tiling cut global reads?',
  'Given a mentor shared the project, When they read its study snapshot, Then the question is there as before');

select ok(
  pg_temp.card('Why does tiling cut global reads?') ? 'answer'
    and pg_temp.card('Why does tiling cut global reads?') ->> 'answer' is null,
  'Given a card with an answer, When a mentor reads it, Then the answer is left out');

select is(
  (select count(*)::integer from jsonb_array_elements(public.tracker_study_snapshot() -> 'reviews') r
    where r ->> 'answer' is not null),
  0,
  'Given every card the mentor can read, When they are read, Then none says an answer');

select * from finish();
rollback;
