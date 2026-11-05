# Personal Project Portal

A small portal for studying PMPP and Axler and for my rendering projects. It
makes the daily and weekly routine faster and gives my mentors a clean read-only
view. Tasks live in Supabase by default, and the same pages can run on Asana with
`TASK_BACKEND=asana`.

| Page | Who | What it does |
| --- | --- | --- |
| Today (`/`) | Me | Needs attention, today's plan, plus what is overdue, due today or in progress, each with a one-click "Log session". |
| Study (`/study`) | Me | Works through Linear Algebra Done Right, PMPP and the Vulkan renderer as one roadmap: next up, steps, every exercise, spaced recall and measured results. Supabase backend only. |
| Tasks (`/tasks`) | Me | Every project at a glance, with list and board views and a panel for the full task. Supabase backend only. |
| Schedule (`/schedule`) | Me | Week planner. Drag tasks into time slots (sets their start and due times). Add lunch, gym and other life blocks, which go to Google Calendar only. |
| Timeline (`/timeline`) | Me and mentors | Dated tasks and milestones across projects, Gantt-style. |
| Log a session (`/log`) | Me | Adds hours to the task's Hours field, sets Stage and Evidence, and posts a session comment. Stage Done completes the task. |
| Sunday update (`/week`) | Me | Drafts each project's status update from the week's sessions in the template mentors expect, then posts it. |
| Progress (`/progress/…`) | Me and mentors | Read-only progress per project: latest status, completion, hours, evidence links. Mentors see only their projects. |
| People (`/people`) | Me | Add mentors and choose which projects each one sees. |
| Claude (`/claude`) | Me | Connect the Claude app, then plan, schedule and log by asking Claude. |

Everyone signs in with Google or an email link (invited accounts only), so mentors don't need accounts anywhere else.

## How it fits together

- **Next.js 15** (App Router, server actions) on **Vercel**.
- **Supabase Auth** for sign-in. The database holds access only, in a private
  `portal` schema reached through four RPCs
  (`supabase/migrations/20261104190000_portal_access.sql`).
- **Tasks** sit behind `src/lib/tasks/tracker.ts`, which picks a backend. The
  default, `src/lib/tasks/native.ts`, stores them in the private `portal` schema
  (`supabase/migrations/20261104220000_native_tasks.sql`) in the same shape as
  Asana's, so a later move means copying rows. Pages never import a backend.
- **Asana REST API**, with `TASK_BACKEND=asana`, from the server only (`src/lib/tasks/asana.ts` imports
  `server-only`). The token is an environment variable and never reaches the
  browser. Every project is checked against the personal workspace gid before
  it is read or written.
- **Google Calendar API** for life blocks, connected once with OAuth. The
  refresh token is AES-256-GCM encrypted with `GOOGLE_TOKEN_KEY` before it is
  stored.
- **Claude connector**: an MCP server at `/api/mcp` with OAuth 2.1 and PKCE,
  so the Claude app can use the portal on my subscription. Its tools call the
  same code as the buttons (`src/lib/portal/operations.ts`), and only token hashes are
  stored (`supabase/migrations/20261104210000_claude_connector.sql`).
- Tools are listed once in `src/lib/config/tools.ts`; projects in `src/lib/config/projects.ts`.

## How studying works

Each book and the renderer is a plan in `src/lib/study`, loaded from the Study page. Loading again only adds what is missing, so your edits and progress are safe.

- **Books track practice, not pages.** Rereading feels productive but does little: self-testing and spaced practice have the strongest evidence (Dunlosky et al., 2013). So each unit has steps built around recalling and doing, every exercise is tracked individually, and key results come back on a widening schedule. The exact gaps are a sensible default, not a proven formula.
- **The renderer tracks results, not just tasks.** Each milestone has a definition of done and benchmarks tied to a commit. Only results with the same metric, scene and GPU are compared.
- **They connect.** A milestone lists the chapters it builds on, and a chapter shows what it feeds into. `links.ts` says where the plans meet and why, and shows on both units.
- **One path through all three.** `roadmap.ts` puts every unit in one of eight phases, each with a reason and a condition for moving on, and paces all three plans together by hours a week. Tests check that every unit has a place and that nothing comes before what it needs. The hours are rough guesses, so correct them once you have real ones.
- **PMPP comes from the book.** Chapters, exercise counts and pages were read from the PDF, in the PDF's own page numbers. Notes are in our own words and the book's text stays out of this repo. The book never mentions ray tracing or Vulkan, so the links to the renderer are our own reading.
- **Kernels run in three places.** CUDA needs NVIDIA and neither GPU here is one, so kernels are written on LeetGPU or a Colab GPU, then ported to Vulkan compute for real timings on the RX 5700 XT and Iris Xe. The roadmap has a CUDA to Vulkan table.

## Layout

```text
src/
  app/          Pages, server actions and API routes. Folders match the URLs.
  components/   UI shared between pages.
  lib/
    auth/       Who is signed in and what they may do.
    calendar/   Google Calendar and life blocks.
    config/     Environment, projects and the list of tools.
    connector/  The Claude connector (MCP and OAuth).
    dates/      Weeks and time zones.
    portal/     What pages show, and every change the portal makes.
    study/      The study plans for each book and the renderer, reviews and results.
    supabase/   Supabase clients.
    tasks/      The task model, both backends and the switch between them.
supabase/       Migrations, database tests and auth config.
docs/           Setup and launch guides.
```

Tests sit next to the code they cover, as `*.test.ts`.

Setup: [docs/SETUP.md](docs/SETUP.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test              # unit tests for dates, session logs and drafts
supabase test db      # pgTAP tests for access rules
```
