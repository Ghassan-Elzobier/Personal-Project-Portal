# Personal Project Portal

A small portal over my personal Asana for studying PMPP and Axler and for my
rendering projects. Asana stays the source of truth; the portal makes the daily
and weekly routine faster and gives my mentors a clean read-only view.

| Page | Who | What it does |
| --- | --- | --- |
| Today (`/`) | Me | Needs attention, today's plan, plus what is overdue, due today or in progress, each with a one-click "Log session". |
| Schedule (`/schedule`) | Me | Week planner. Drag Asana tasks into time slots (writes start and due times to Asana). Add lunch, gym and other life blocks, which go to Google Calendar only. |
| Timeline (`/timeline`) | Me and mentors | Dated tasks and milestones across projects, Gantt-style. |
| Log a session (`/log`) | Me | Adds hours to the task's Hours field, sets Stage and Evidence, and posts a session comment. Stage Done completes the task. |
| Sunday update (`/week`) | Me | Drafts each project's status update from the week's sessions in the template mentors expect, then posts it to Asana. |
| Progress (`/progress/…`) | Me and mentors | Read-only progress per project: latest status, completion, hours, evidence links. Mentors see only their projects. |
| People (`/people`) | Me | Add mentors and choose which projects each one sees. |
| Claude (`/claude`) | Me | Connect the Claude app, then plan, schedule and log by asking Claude. |

Everyone signs in with Google or an email link (invited accounts only), so mentors don't need Asana seats.

## How it fits together

- **Next.js 15** (App Router, server actions) on **Vercel**.
- **Supabase Auth** for sign-in. The database holds access only, in a private
  `portal` schema reached through four RPCs
  (`supabase/migrations/20261104190000_portal_access.sql`).
- **Asana REST API** from the server only (`lib/asana.ts` imports
  `server-only`). The token is an environment variable and never reaches the
  browser. Every project is checked against the personal workspace gid before
  it is read or written.
- **Google Calendar API** for life blocks, connected once with OAuth. The
  refresh token is AES-256-GCM encrypted with `GOOGLE_TOKEN_KEY` before it is
  stored.
- **Claude connector**: an MCP server at `/api/mcp` with OAuth 2.1 and PKCE,
  so the Claude app can use the portal on my subscription. Its tools call the
  same code as the buttons (`lib/operations.ts`), and only token hashes are
  stored (`supabase/migrations/20261104210000_claude_connector.sql`).
- Tools are listed once in `lib/tools.ts`; projects in `lib/projects.ts`.

Setup: [docs/SETUP.md](docs/SETUP.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test              # unit tests for dates, session logs and drafts
supabase test db      # pgTAP tests for access rules
```
