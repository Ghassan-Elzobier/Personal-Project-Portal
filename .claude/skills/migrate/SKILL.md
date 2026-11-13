---
name: migrate
description: Change the database safely - a new table, column, RPC or policy in Supabase, with its pgTAP test, deployed by CI before the code that needs it. Use for any change under supabase/.
argument-hint: "[what the database needs]"
---

# Change the database

Change: $ARGUMENTS

1. **New file, never an edit.** `npx supabase migration new <snake_name>`. Files
   on main are applied in production and must not change (the guard enforces it).
2. **Keep the access model.** Tables live in the private `portal` schema, which
   the API roles cannot reach. Pages and the connector call `public` RPCs that
   check access (`security definer`, `set search_path to ''`, owner or member
   checks first). Row level security on every table. Read
   `supabase/migrations/20261104190000_portal_access.sql` for the pattern.
3. **Expand, then contract.** Production gets the migration first and the code
   seconds later, and the previous deployment may still be serving. So a
   migration must work with both the old and the new code: add columns nullable
   or with defaults, add new RPCs beside old ones, and remove old ones in a later
   pull request once nothing calls them.
4. **Test it.** Add or extend a file in `supabase/tests/database/` (pgTAP, one
   transaction that rolls back, Given/When/Then descriptions, made-up emails).
   `npm run db:start` (or `npx supabase db reset` after editing), then
   `npm run test:db`.
5. **Seed if pages need it.** Test data goes in `supabase/seed.sql`, made up.
6. **Ship it with `/ship`.** On merge, `.github/workflows/release.yml` applies the
   migration to production, and Vercel waits for that before going live. Never
   run `supabase db push` against production from a session.
