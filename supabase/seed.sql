-- Test data for local stacks and CI only. `supabase start` and `supabase db
-- reset` load it; `supabase db push` never does, so it never reaches the live
-- database. Every name here is made up: this repository is public.
--
-- One owner account. The end-to-end suite signs in as it (e2e/auth.setup.ts).

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'email',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"owner@example.test","email_verified":true}',
  now(), now(), now()
);

insert into portal.members (account_id, role, display_name)
values ('00000000-0000-4000-8000-000000000001', 'owner', 'Test Owner');

-- Production errors for the errors page (/errors), made up, around the suite's
-- pinned day (2026-11-16): a filed bug with occurrences and breadcrumbs, a new
-- one from the browser, and one ignored. Already scrubbed, as real ones are.
insert into portal.error_groups
  (fingerprint, source, name, message, route, context, stack, release, occurrences, first_seen, last_seen, status, issue_number, synced_at)
values
  ('5eed0000000000000000000000000001', 'server', 'TypeError',
   'Cannot read properties of undefined (reading ''title'')', '/life/recipes/[key]', 'render',
   E'at RecipePage (src/app/life/recipes/[key]/page.tsx:42:7)\nat renderWithHooks (node_modules/react-dom/cjs/react-dom-server.js:10:20)',
   'abcdef1234567890abcdef1234567890abcdef12', 6, '2026-11-09T08:15:00Z', '2026-11-16T07:45:00Z', 'filed', 7, '2026-11-16T08:00:00Z'),
  ('5eed0000000000000000000000000002', 'browser', 'RangeError', 'Invalid time value', '/schedule', 'uncaught',
   'at formatSlot (src/app/schedule/week-planner.tsx:120:15)', 'abcdef1234567890abcdef1234567890abcdef12',
   2, '2026-11-15T19:02:00Z', '2026-11-16T08:10:00Z', 'new', null, null),
  ('5eed0000000000000000000000000003', 'connector', 'Error', 'Life: ‹text›', '/api/mcp', 'tool log_meal', '',
   null, 1, '2026-11-12T12:30:00Z', '2026-11-12T12:30:00Z', 'ignored', null, '2026-11-12T13:00:00Z');

insert into portal.error_daily (fingerprint, day, occurrences)
values
  ('5eed0000000000000000000000000001', '2026-11-09', 1),
  ('5eed0000000000000000000000000001', '2026-11-12', 2),
  ('5eed0000000000000000000000000001', '2026-11-16', 3),
  ('5eed0000000000000000000000000002', '2026-11-15', 1),
  ('5eed0000000000000000000000000002', '2026-11-16', 1),
  ('5eed0000000000000000000000000003', '2026-11-12', 1);

insert into portal.error_events
  (fingerprint, occurred_at, release, reporter, browser, os, device, viewport, stack, breadcrumbs)
values
  ('5eed0000000000000000000000000001', '2026-11-16T07:45:00Z', 'abcdef1234567890abcdef1234567890abcdef12', 'owner',
   'Chrome 131', 'Android 15', 'phone', null, '', '[]'),
  ('5eed0000000000000000000000000001', '2026-11-12T18:20:00Z', 'abcdef1234567890abcdef1234567890abcdef12', 'mentor',
   'Firefox 133', 'Windows', 'desktop', null, '', '[]'),
  ('5eed0000000000000000000000000002', '2026-11-16T08:10:00Z', 'abcdef1234567890abcdef1234567890abcdef12', 'owner',
   'Chrome 131', 'Android 15', 'phone', '412x915', '',
   '[{"at":"2026-11-16T08:09:41.000Z","kind":"navigation","text":"load → /schedule"},
     {"at":"2026-11-16T08:09:55.000Z","kind":"click","text":"button.btn-ghost"},
     {"at":"2026-11-16T08:09:56.000Z","kind":"action","text":"server action on /schedule → 200 (184 ms)"},
     {"at":"2026-11-16T08:10:00.000Z","kind":"console","text":"error: RangeError: Invalid time value"}]');

-- One finished lesson with a plan and answers, for the Learn pages. No claims or
-- chains: the tutor's database tests count those.
insert into portal.tutor_sessions (kind, goal, status, plan, summary, created_at, updated_at)
values (
  'teach', 'Example: why tiling cuts memory traffic', 'done',
  '{"revision": 2, "nodes": [{"id": "memory", "label": "Memory is slow", "status": "done"}, {"id": "reuse", "label": "Threads reuse a tile", "status": "done"}, {"id": "tiling", "label": "Tiling", "status": "done"}], "edges": [["memory", "tiling"], ["reuse", "tiling"]]}',
  'Example summary: loading each tile once serves every thread that needs it.',
  '2026-11-13T10:00:00Z', '2026-11-13T10:40:00Z'
);
insert into portal.tutor_answers (session_gid, kind, question, answer, dont_know, correct, confidence, thinking, feedback, created_at)
select s.gid, a.kind, a.question, a.answer, a.dont_know, a.correct, a.confidence, a.thinking, a.feedback, '2026-11-13T10:05:00Z'
from portal.tutor_sessions s,
  (values
    ('probe', 'What does a warp do?', '', true, null::boolean, null::smallint, '', 'No problem: we start there.'),
    ('check', 'Why does loading a tile once help?', 'Fewer trips to slow memory', false, true, 80::smallint, 'Every thread needs the same numbers.', 'Yes: one load serves the whole block.'),
    ('check', 'What limits the kernel before tiling?', 'The arithmetic', false, false, 90::smallint, 'It does a lot of multiplying.', 'Close, but the limit is how fast the data arrives.')
  ) as a(kind, question, answer, dont_know, correct, confidence, thinking, feedback)
where s.goal = 'Example: why tiling cuts memory traffic';
