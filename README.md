# Personal Project Portal

A small portal over my personal Asana for studying PMPP and Axler and for my
rendering projects. Asana stays the source of truth; the portal makes the daily
and weekly routine faster and gives my mentors a clean read-only view.

| Page | Who | What it does |
| --- | --- | --- |
| Today (`/`) | Me | Needs attention, plus what is overdue, due today or in progress, each with a one-click "Log session". |
| Log a session (`/log`) | Me | Adds hours to the task's Hours field, sets Stage and Evidence, and posts a session comment. Stage Done completes the task. |
| Sunday update (`/week`) | Me | Drafts each project's status update from the week's sessions in the template mentors expect, then posts it to Asana. |
| Progress (`/progress/…`) | Me and mentors | Read-only progress per project: latest status, completion, hours, evidence links. Mentors see only their projects. |
| People (`/people`) | Me | Add mentors and choose which projects each one sees. |

Mentors sign in with a magic link, so they don't need Asana seats.

## How it fits together

- **Next.js 15** (App Router, server actions) on **Vercel**.
- **Supabase Auth** for sign-in. The database holds access only, in a private
  `portal` schema reached through four RPCs
  (`supabase/migrations/20261104190000_portal_access.sql`).
- **Asana REST API** from the server only (`lib/asana.ts` imports
  `server-only`). The token is an environment variable and never reaches the
  browser. Every project is checked against the personal workspace gid before
  it is read or written.
- Tools are listed once in `lib/tools.ts`; projects in `lib/projects.ts`.

Setup: [docs/SETUP.md](docs/SETUP.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test              # unit tests for dates, session logs and drafts
supabase test db      # pgTAP tests for access rules
```
