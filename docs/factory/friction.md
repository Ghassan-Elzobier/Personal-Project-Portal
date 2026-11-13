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

## Done

- 2026-11-13 · ci · the Claude review failed on every Dependabot PR (no secrets for bots) · the review skips Dependabot (factory PR 2)
- 2026-11-13 · deps · Dependabot proposed @types/node 26 and TypeScript 7, which the toolchain can't take (TS 7 fails typescript-eslint) · ignore rules for those majors (factory PR 2)
- 2026-11-13 · deploys · Vercel's check picker didn't list "Migrate production database" · the release job posts a "Production database migrated" commit status (factory PR 2)
- 2026-11-13 · phone layout · pages scrolled sideways on a Pixel 7 more than once · e2e/pages.spec.ts checks every page at 412 and 360 px (factory PR)
- 2026-11-13 · pages · a second `next dev` wiped `.next` and broke the running server · Next.js 16 keeps dev output in `.next/dev` and locks it (factory PR)
- 2026-11-13 · deploys · merging deployed code before its migration · release.yml migrates, Vercel Deployment Checks wait for it (factory PR)
