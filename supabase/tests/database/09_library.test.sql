-- Suite: the book library
--
-- Only the owner reads the book, from a session or with a live connector token.
-- Mentors, anon and expired tokens get nothing, and the tables stay closed to
-- the API roles. Search puts pages that match every idea first.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

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

create temp table fx (k text primary key, v uuid) on commit drop;
grant select on fx to authenticated, anon;
insert into fx values
  ('owner', pg_temp.make_user('library-owner@test.local')),
  ('mentor', pg_temp.make_user('library-mentor@test.local'));
insert into portal.members (account_id, role, display_name) values
  ((select v from fx where k = 'owner'), 'owner', 'Owner'),
  ((select v from fx where k = 'mentor'), 'mentor', 'Mentor');
insert into portal.mcp_tokens (account_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values
  ((select v from fx where k = 'owner'), 'test', encode(sha256('library-live'), 'hex'), now() + interval '1 hour', encode(sha256('library-live-refresh'), 'hex'), now() + interval '1 day'),
  ((select v from fx where k = 'owner'), 'test', encode(sha256('library-expired'), 'hex'), now() - interval '1 minute', encode(sha256('library-expired-refresh'), 'hex'), now() + interval '1 day');

-- Made-up pages: one about both ideas, one about warps only, one about neither,
-- and one that only its section heading ties to divergence.
insert into portal.book_pages (book, page, kind, chapter, section, heading, body) values
  ('test-book', 10, 'body', '4', '4.5', 'Ch 4 Test › 4.5 Control divergence', 'Threads in a warp take different paths, so divergence costs time.'),
  ('test-book', 11, 'body', '4', '4.4', 'Ch 4 Test › 4.4 Warps', 'A warp runs one instruction stream for all its threads.'),
  ('test-book', 12, 'body', '5', '5.1', 'Ch 5 Test › 5.1 Memory bandwidth', 'Bandwidth limits how fast data reaches the cores.'),
  ('test-book', 13, 'body', '6', '6.1', 'Ch 6 Test › 6.1 Reducing divergence', 'Sort the work so neighbours take the same path.');
insert into portal.book_sections (book, number, chapter, title, first_page, last_page) values
  ('test-book', '4', '4', 'Test', 10, 11),
  ('test-book', '4.4', '4', 'Warps', 11, 11),
  ('test-book', '4.5', '4', 'Control divergence', 10, 10),
  ('test-book', '5', '5', 'Test memory', 12, 12),
  ('test-book', '5.1', '5', 'Memory bandwidth', 12, 12);

-- The owner, in the browser
select pg_temp.act_as((select v from fx where k = 'owner'));

select is(
  (public.library_search('test-book', '[["warp"],["divergence"]]') -> 'results' -> 0 ->> 'page')::int,
  10,
  'the page matching every idea comes first'
);
select is(
  (public.library_search('test-book', '[["warp"],["divergence"]]') ->> 'matched_every_term')::int,
  1,
  'only one page matches every idea'
);
select is(
  jsonb_array_length(public.library_search('test-book', '[["warp"],["divergence"]]') -> 'results'),
  3,
  'pages matching some ideas follow'
);
select is(
  (public.library_search('test-book', '[["reducing"]]') -> 'results' -> 0 ->> 'page')::int,
  13,
  'a section heading counts, even when the page text does not say it'
);
select is(
  (public.library_search('test-book', '[["warp"]]', '5') -> 'results'),
  '[]'::jsonb,
  'the chapter filter keeps other chapters out'
);
select ok(
  position(chr(1) in public.library_search('test-book', '[["bandwidth"]]') -> 'results' -> 0 ->> 'excerpt') > 0,
  'excerpts mark the matches'
);
select is(
  (select jsonb_agg(p -> 'page') from jsonb_array_elements(public.library_read('test-book', null, '4.5', 3) -> 'pages') p),
  '[10, 11, 12]'::jsonb,
  'reading a section starts at its first page'
);
select is(
  (public.library_outline('test-book') ->> 'pages')::int,
  4,
  'the outline counts the pages'
);
select throws_ok(
  $$ select public.library_search('test-book', '"warp"') $$,
  '22023', null, 'search terms must be a list'
);
select throws_ok(
  $$ select public.library_read('test-book', null, '9.9') $$,
  'P0002', null, 'an unknown section says so'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('library', 'test.pdf') $$,
  'the owner can add the PDF'
);

-- A mentor
select pg_temp.act_as((select v from fx where k = 'mentor'));
select throws_ok(
  $$ select public.library_search('test-book', '[["warp"]]') $$,
  '42501', null, 'a mentor cannot search the book'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('library', 'mentor.pdf') $$,
  '42501', null, 'a mentor cannot add to the library'
);

-- The connector, with no session
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select is(
  jsonb_array_length(public.library_search('test-book', '[["warp"]]', null, 6, encode(sha256('library-live'), 'hex')) -> 'results'),
  2,
  'a live connector token for the owner can search'
);
select throws_ok(
  $$ select public.library_outline('test-book', encode(sha256('library-expired'), 'hex')) $$,
  '42501', null, 'an expired token cannot'
);
select throws_ok(
  $$ select count(*) from portal.book_pages $$,
  '42501', null, 'the tables stay closed to the API roles'
);

select * from finish();
rollback;
