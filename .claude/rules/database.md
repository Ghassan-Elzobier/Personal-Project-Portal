---
paths:
  - "supabase/**"
  - "src/lib/supabase/**"
---

# Database rules

- Follow the `/migrate` skill. Migrations are append-only once on main; the
  guard fails a pull request that edits one.
- Data lives in the private `portal` schema; the API reaches it only through
  `public` RPCs that are `security definer`, `set search_path to ''`, and check
  the caller's access first. Row level security is on for every table.
- Migrations must work with the old and the new code at once (expand, then
  contract): production applies them moments before the new deployment.
- Every migration has pgTAP tests in `supabase/tests/database/`, each file one
  transaction that rolls back and starts from a known state (seed data exists).
- `supabase/seed.sql` is test data for local stacks and CI: made-up names only.
- Supabase CLI v3 (pinned in package.json): commands act on the local stack
  unless given `--remote`, and hosted changes need `--yes`. The local stack uses
  ports 554xx. Never push migrations to production from a session; CI does it.
