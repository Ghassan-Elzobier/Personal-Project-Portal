# Agent guide

The owner's personal portal: study (PMPP, Axler, a Vulkan renderer), the job hunt,
and life (meals, kitchen, gym, body). Next.js 16 on Vercel, Supabase, Tailwind 4.
This file is the map; the details sit in the files it points to. It applies to
every agent, in the terminal, the IDE, the cloud, GitHub (`@claude`) and routines.

## Rules that never bend

- **The repository is public.** No secrets, no personal data, no real employer
  names, no book text. Personal facts live in the database. Use made-up data in
  tests and seeds (`example.test`, "Example Ltd").
- **No AI attribution.** Never add `Co-Authored-By` or any AI co-author credit to
  commits, nor "Generated with Claude Code" or similar to pull requests.
- **Work on a branch, deliver a pull request.** Branches are `claude/<short-name>`.
  Nobody pushes to main; the owner merges. Merging deploys production.
- **Migrations are append-only.** Never edit one that is on main. Production gets
  them from CI (`.github/workflows/release.yml`), never from a laptop.
- **Tests are acceptance checks.** Add freely. Never weaken, delete or re-record an
  existing test or screenshot to get green; if one is truly wrong, say why in the PR
  (the guard then needs the owner's `approved-test-change` label).
- **Never grow a ratchet.** Don't run `eslint --suppress-all` or add to
  `e2e/a11y-baseline.json`; fix the code. Shrinking them is always welcome.

## How work flows

Use the `/ship` skill for any change; it holds the details. In short:

1. Understand: read the issue or request, the code it touches, and the rules for
   those paths (`.claude/rules/`). Ask the owner only what the code can't answer.
2. Plan small: one change per pull request. For anything bigger than a few files,
   plan first (plan mode) and keep a checklist in the PR.
3. Build on what exists: shared components from `src/components/ui.tsx` and `/design`,
   tokens from `src/app/globals.css`, operations from `src/lib/portal`. Make a new
   shared piece rather than a one-off, and add it to `/design`.
4. Verify like a user: `npm run check`, then `npm run test:e2e` when a page changed,
   and look at the page at 412 px and 360 px. Unit tests alone are not done.
5. Pull request with the template; watch CI (`gh pr checks --watch`) and fix it.
6. Log friction: if the factory slowed you down or let a mistake through, add one
   line to `docs/factory/friction.md`. That is how the factory improves.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | Format, lint, types, unit tests and dead code. Run before every commit. |
| `npm run test:e2e` | Pages, accessibility and screenshots at phone and desktop sizes. |
| `npm run test:e2e:update` | Re-render screenshots, only for a deliberate design change. |
| `npm run test:db` | pgTAP tests on the local database (`npm run db:start` first). |
| `npm run guard` | The CI guard: migrations, ratchets, protected tests. |
| `npm run health` | The refactor queue: what most needs improving, ranked. |

The local Supabase stack uses ports 554xx (`supabase/config.toml`). CLI v3 commands
act on the local stack unless given `--remote`.

## Map

- `src/app/` pages, server actions and routes; folders match URLs.
- `src/components/` shared UI. `src/app/design/page.tsx` shows all of it.
- `src/lib/<domain>/` pure domain logic with tests beside it; `src/lib/portal/` is
  what pages call. Layers and import rules: `docs/ARCHITECTURE.md`.
- `supabase/migrations/`, `supabase/tests/` (pgTAP), `supabase/seed.sql` (test data).
- `e2e/` Playwright suites; `scripts/` loaders and the factory's own tools.
- `docs/FACTORY.md` how this factory works and why. `docs/DESIGN.md` the design system.

## Context worth knowing

- The owner uses the portal on a Pixel 7. Phone layout comes first.
- Pages must change the moment a tap changes data: key client state to its data,
  never copy props into state, and no router caching or streaming on pages with saves.
- Server code asks the time from `src/lib/dates/clock.ts`, never `new Date()` for "today".
- Production errors become public bug issues (`src/lib/errors`). Put variable values
  in error messages in quotes (`` `No recipe '${key}'` ``): the tracker removes quoted
  free text and keeps code-like keys, but cannot tell unquoted values from wording.
  The lint rule `portal/quoted-error-values` checks it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
