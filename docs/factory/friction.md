# Friction log

What slowed an agent or the owner down, or let a mistake through. One line each,
added in the same pull request as the work, by whoever hit it. The weekly
`/improve-factory` pass reads "Open", turns what repeats into a rule or a check,
and moves those lines to "Done". Short and factual: no private data.

Format: `- YYYY-MM-DD · area · what happened · what would have prevented it (guess)`

## Open

- 2026-11-13 · deps · the minimatch security alert (development only, via typescript-eslint) can't be fixed by Dependabot: the parent's range excludes the patched major · revisit when typescript-eslint moves to minimatch 11; dismissed as tolerable meanwhile
- 2026-11-13 · ci · first CI run failed `npm ci`: the lockfile came from npm 11.6 locally, CI runs npm 11.19, which wants optional @emnapi packages recorded · devEngines in package.json now warns on an older npm; upgrade local Node 24 (`fnm install 24`)
- 2026-11-13 · lint · eslint-config-next 16 found setState in effects in nav-links and the divergence explorer; suppressed for now · characterisation tests for the Work/Life switch, then fix (refactor queue)
- 2026-11-13 · database · the access test assumed an empty members table and broke when seed data arrived · every pgTAP file starts from a known state (done for 01; check the others when they next change)
- 2026-11-13 · architecture · tasks, life and library import database-client helpers from the Claude connector, a folder-level cycle · move connectorCaller and anonClient to src/lib/supabase (refactor queue)
- 2026-11-14 · e2e · a Dependabot bump of the Supabase CLI meant a new 2.3 GB Postgres image, and the scratch stack stalled for about 25 minutes on a nearly full disk · say in docs/SETUP.md that CLI bumps pull new images, and check `df -h /` before `db:start`
- 2026-11-14 · pull requests · stacked PRs were merged within minutes, and the auto-mode classifier blocks force-pushes, so a rebased branch had to go up under a new name (a stale `claude/lab-type-scale` is left on the remote) · open the next PR in a stack only after its base merges, or merge the base in instead of rebasing
- 2026-11-14 · design · renaming a colour token can change which class wins, because Tailwind orders same-property utilities alphabetically; `no-conflicting-classes` only sees static strings · checked by hand this time; a codemod check that lists elements with two text colours would catch it
- 2026-11-14 · accessibility · axe can't measure text on gradient cards, so `text-faint` (about 2.9:1 on a card) never shows up as a finding · a contrast unit test over the token pairs in globals.css
- 2026-11-14 · database · `npm run test:db` pulled the pg_prove image with no output and stalled for 8 minutes on a slow link; the same files passed when piped through psql in the db container · a test:db fallback that runs each file with psql when pg_prove is missing
- 2026-11-14 · e2e · `next build` failed outright when fonts.gstatic.com timed out once (next/font/google downloads at build time) · self-host Funnel Display with next/font/local so builds need no network

## Done

- 2026-11-14 · build · `outputFileTracingIncludes` did nothing: Next applies it only in webpack's trace step, and Turbopack builds skip it, so source maps never reached the functions · scripts/pack-source-maps.mjs edits the traces, and e2e/error-maps-private.spec.ts checks the error intake's (this PR)
- 2026-11-14 · build · the map loader's `join(process.cwd(), path)` made Turbopack deploy the whole project with every function; the warning sat in a passing build log and reached production · the read carries `turbopackIgnore`, and e2e/error-maps-private.spec.ts fails when any function trace includes the project's own files (this PR)
- 2026-11-13 · ci · the Claude review failed on every Dependabot PR (no secrets for bots) · the review skips Dependabot (factory PR 2)
- 2026-11-13 · deps · Dependabot proposed @types/node 26 and TypeScript 7, which the toolchain can't take (TS 7 fails typescript-eslint) · ignore rules for those majors (factory PR 2)
- 2026-11-13 · deploys · Vercel's check picker didn't list "Migrate production database" · the release job posts a "Production database migrated" commit status (factory PR 2)
- 2026-11-13 · phone layout · pages scrolled sideways on a Pixel 7 more than once · e2e/pages.spec.ts checks every page at 412 and 360 px (factory PR)
- 2026-11-13 · pages · a second `next dev` wiped `.next` and broke the running server · Next.js 16 keeps dev output in `.next/dev` and locks it (factory PR)
- 2026-11-13 · deploys · merging deployed code before its migration · release.yml migrates, Vercel Deployment Checks wait for it (factory PR)
- 2026-11-14 · ci · the error triage passed every local run and crashed in GitHub Actions: `supabase db query` wraps its JSON when it detects an AI agent (as in a Claude session) and prints a plain list otherwise · the triage passes `--agent no` and reads both shapes, with a test (this PR)
