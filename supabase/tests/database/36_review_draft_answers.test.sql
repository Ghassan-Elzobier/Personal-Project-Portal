-- Suite: Claude's draft answers for recall cards (20261127155202_review_draft_answers.sql)
--
-- A draft goes only on a card that still has no answer: the tutor's words are never
-- written over, a blank draft saves nothing, and a retired card is left alone. Only the
-- owner can save drafts, and the connector has no route in.

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
grant select, insert, update on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('draft-owner@test.local')::text),
  ('mentor', pg_temp.make_user('draft-mentor@test.local')::text);
insert into portal.members (account_id, role, display_name) values
  ((select v::uuid from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v::uuid from fx where k = 'mentor'), 'mentor', 'Mentor');

-- A unit with three made-up cards: one with no answer, one with the tutor's, one retired.
insert into portal.sections (project, name) values ('pmpp', 'Draft test');
insert into portal.tasks (project, section_gid, ref, name)
  select 'pmpp', gid, 'draft-test', 'A unit for the draft test' from portal.sections where name = 'Draft test';
insert into portal.reviews (task_gid, kind, prompt, due_on, answer, retired_at)
  select t.gid, 'idea', x.prompt, current_date, x.answer, x.retired_at
  from portal.tasks t,
       (values ('Example: a card with no answer', null::text, null::timestamptz),
               ('Example: a card with the tutor''s answer', 'The tutor''s words.', null),
               ('Example: a retired card', null, now())) x(prompt, answer, retired_at)
  where t.ref = 'draft-test';
insert into fx select 'plain', gid::text from portal.reviews where prompt = 'Example: a card with no answer';
insert into fx select 'tutor', gid::text from portal.reviews where prompt = 'Example: a card with the tutor''s answer';
insert into fx select 'retired', gid::text from portal.reviews where prompt = 'Example: a retired card';

select is(
  (select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname = 'public' and f.proname = 'tracker_set_review_answers'
     and (has_function_privilege('anon', f.oid, 'execute') or pg_get_function_arguments(f.oid) like '%p_access_hash%')),
  0,
  'Given the draft RPC, When its rights and arguments are inspected, Then anon may not run it and no connector token is accepted');

select pg_temp.act_as((select v::uuid from fx where k = 'mentor'));
select throws_ok(
  format($$ select public.tracker_set_review_answers('[{"gid": "%s", "answer": "Claude''s draft: x"}]'::jsonb) $$, (select v from fx where k = 'plain')),
  '42501', null, 'Given a mentor, When they save a draft, Then they are refused');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(
  public.tracker_set_review_answers(jsonb_build_array(
    jsonb_build_object('gid', (select v from fx where k = 'plain'), 'answer', '  Claude''s draft: It is read once.  '),
    jsonb_build_object('gid', (select v from fx where k = 'tutor'), 'answer', 'Claude''s draft: Over the tutor.'),
    jsonb_build_object('gid', (select v from fx where k = 'retired'), 'answer', 'Claude''s draft: On a retired card.'),
    jsonb_build_object('gid', '-1', 'answer', 'Claude''s draft: Nowhere.'))),
  1,
  'Given drafts for four cards, When the owner saves them, Then only the card with no answer takes one');
-- Read the cards as the table owner: the API roles can't see the table.
reset role;
select is(
  (select answer from portal.reviews where gid = (select v::bigint from fx where k = 'plain')),
  'Claude''s draft: It is read once.',
  'Then the card with no answer has the draft, trimmed');
select is(
  (select answer from portal.reviews where gid = (select v::bigint from fx where k = 'tutor')),
  'The tutor''s words.',
  'Then the tutor''s words are not written over');
select is(
  (select answer from portal.reviews where gid = (select v::bigint from fx where k = 'retired')),
  null,
  'Then the retired card is left alone');

select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(
  public.tracker_set_review_answers(jsonb_build_array(
    jsonb_build_object('gid', (select v from fx where k = 'plain'), 'answer', 'Claude''s draft: A second go.'))),
  0,
  'Given a card that now has a draft, When another is saved, Then the first stands');
reset role;
update portal.reviews set answer = null where gid = (select v::bigint from fx where k = 'plain');
select pg_temp.act_as((select v::uuid from fx where k = 'owner'));
select is(
  public.tracker_set_review_answers(jsonb_build_array(
    jsonb_build_object('gid', (select v from fx where k = 'plain'), 'answer', '   '),
    jsonb_build_object('gid', (select v from fx where k = 'plain'), 'answer', repeat('x', 1001)))),
  0,
  'Given a blank draft and an over-long one, When they are saved, Then nothing changes and nothing fails');
reset role;
select is(
  (select answer from portal.reviews where gid = (select v::bigint from fx where k = 'plain')),
  null,
  'Then the card still has no answer');

select * from finish();
rollback;
