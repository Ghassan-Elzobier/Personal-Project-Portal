# Personal Project Portal

A small portal for studying PMPP and Axler and for my rendering projects. It
makes the daily and weekly routine faster and gives my mentors a clean read-only
view. Tasks live in Supabase by default, and the same pages can run on Asana with
`TASK_BACKEND=asana`.

| Page | Who | What it does |
| --- | --- | --- |
| Today (`/`) | Me | Studying, the job market and the job hunt side by side, then needs attention, today's plan, plus what is overdue, due today or in progress, each with a one-click "Log session". |
| Study (`/study`) | Me | Works through Linear Algebra Done Right, PMPP and the Vulkan renderer as one roadmap: next up, steps, every exercise, spaced recall and measured results. Supabase backend only. |
| Lab (`/lab`) | Me | How the renderer works, in 17 views drawn from its code: Vulkan setup, the swapchain and sync, the ray tracer's maths worked through with real pixels, and how it runs on the GPU. Every line of the code maps to a view, each step links to its lines at a pinned commit and to the PMPP section behind it. Includes a divergence explorer and a barrier walkthrough. |
| Book (`/library`) | Me | Search and read PMPP from your own PDF, in Vulkan words or CUDA ones, and open the PDF at any page. |
| Jobs (`/jobs`) | Me | The roles out there, what each asks for and where I stand on it, with a quote from the advert and evidence or a plan date beside every requirement. Supabase backend only. |
| Tasks (`/tasks`) | Me | Every project at a glance, with list and board views and a panel for the full task. Supabase backend only. |
| Schedule (`/schedule`) | Me | Week planner. Drag tasks into time slots (sets their start and due times), then add more study sessions on a task from its block. Add lunch, gym and other life blocks. Study and life blocks both go to Google Calendar, and invites you have not accepted stay hidden unless you show them. |
| Timeline (`/timeline`) | Me and mentors | Dated tasks and milestones across projects, Gantt-style. |
| Log a session (`/log`) | Me | Adds hours to the task's Hours field, sets Stage and Evidence, and posts a session comment. Stage Done completes the task. |
| Sunday update (`/week`) | Me | Drafts each project's status update from the week's sessions in the template mentors expect, then posts it. |
| Roadmap (`/roadmap`) | Me and mentors | The study roadmap, read-only: phases, progress, the finish date, what is overdue and recent recall practice. A mentor sees only the plans shared with them. |
| Job hunt (`/job-hunt`) | Me and mentors I share it with | The closest roles, the skills gap, the choice after phase 3 and application counts. Never notes, next actions, ratings, contacts or advert text. |
| Progress (`/progress/…`) | Me and mentors | Read-only progress per project: latest status, completion, hours, evidence links. Mentors see only their projects. |
| People (`/people`) | Me | Add mentors, choose which projects each one sees, and switch the job hunt on for each. |
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
- **Google Calendar API** for life blocks and study time, connected once with OAuth.
  A task's slot is mirrored there, and extra study sessions on a task live
  there only (`src/lib/calendar/study-events.ts`). The
  refresh token is AES-256-GCM encrypted with `GOOGLE_TOKEN_KEY` before it is
  stored.
- **Claude connector**: an MCP server at `/api/mcp` with OAuth 2.1 and PKCE,
  so the Claude app can use the portal on my subscription. Its tools call the
  same code as the buttons (`src/lib/portal/operations.ts`), and only token hashes are
  stored (`supabase/migrations/20261104210000_claude_connector.sql`).
- **Book library**: PMPP's pages in the private `portal` schema, searched with Postgres full-text search and reached through three owner-only RPCs (`supabase/migrations/20261111120000_library.sql`). The PDF sits in a private storage bucket, opened through signed links.
- Tools are listed once in `src/lib/config/tools.ts`; projects in `src/lib/config/projects.ts`.

## How studying works

Each book and the renderer is a plan in `src/lib/study`, loaded from the Study page. Loading again only adds what is missing, so your edits and progress are safe.

- **Books track practice, not pages.** Rereading feels productive but does little: self-testing and spaced practice have the strongest evidence (Dunlosky et al., 2013). So each unit has steps built around recalling and doing, every exercise is tracked individually, and key results come back on a widening schedule. The exact gaps are a sensible default, not a proven formula.
- **The renderer tracks results, not just tasks.** Each milestone has a definition of done and benchmarks tied to a commit. Only results with the same metric, scene and GPU are compared.
- **They connect.** A milestone lists the chapters it builds on, and a chapter shows what it feeds into. `links.ts` says where the plans meet and why, and shows on both units.
- **One path through all three.** `roadmap.ts` puts every unit in one of eight phases, each with a reason and a condition for moving on, and paces all three plans together by hours a week. Tests check that every unit has a place and that nothing comes before what it needs. The hours are rough guesses, so correct them once you have real ones.
- **PMPP comes from the book.** Chapters, exercise counts and pages were read from the PDF, in the PDF's own page numbers. Notes are in our own words and the book's text stays out of this repo. The book never mentions ray tracing or Vulkan, so the links to the renderer are our own reading.
- **GPU MODE sits beside the book.** Its lectures that cover a core chapter are a step in that chapter, and the rest are links on the chapters they suit. The links search GPU MODE's YouTube channel, because the video titles differ from the lecture repository's.
- **Kernels run in three places.** CUDA needs NVIDIA and neither GPU here is one, so kernels are written on LeetGPU or a Colab GPU, then ported to Vulkan compute for real timings on the RX 5700 XT and Iris Xe. The roadmap has a CUDA to Vulkan table.

## How the Lab and the book work

The Lab explains the renderer, and the book lets you check every explanation against PMPP. Both are also tools for Claude, so it explains the code the way the diagrams draw it and cites the book by section and page. Why it is built this way, and what drawing found: [reports/Renderer diagrams and PMPP library.md](reports/Renderer%20diagrams%20and%20PMPP%20library.md).

- **Drawn from the code, not from memory.** `src/lib/lab/guide.ts` holds each view's steps, line links, PMPP sections, numbers and check-yourself questions, plus a code map that a test keeps covering every line of main.cpp, raytrace.comp and CMakeLists.txt. Worked examples (a pixel's camera ray, its sphere tests, its path's colour, its random numbers) are computed from the shader model, not typed in. The figures are hand-written SVG in the portal's palette; the two charts use d3-scale and d3-shape, and the two walkthroughs use Motion.
- **Every number says where it came from.** Measured on the Iris Xe, computed by `src/lib/lab/pathtracer.ts` (the shader's logic in TypeScript, checked against a C build of its hash), from the code, or a published figure. Tests keep the quoted numbers in step with the model.
- **Lines are pinned.** Links point at the renderer commit in `guide.ts`. When main.cpp is split, move the commit and re-check the lines.
- **The book speaks CUDA, the renderer Vulkan.** `src/lib/library/query.ts` adds the book's word for each Vulkan or GLSL one, and says what it added. Headings are weighted above page text, and a section that teaches an idea outranks pages that mention it.
- **The book stays private.** `npm run load:book` reads your own PDF into your database; none of it is in this repo, and only the owner can read it, from the portal or the connector.

## How job tracking works

The point is to test the study plan against the market, not only to list roles. It shows which skills employers keep asking for, which of those are evidenced, which the plan will reach and when, and which the plan never reaches.

- **Roles come from feeds that allow it.** Greenhouse, Ashby, Lever, Workable and Teamtailor for employers I follow, plus Arbeitnow UK and the RSE Society to find new ones. `src/lib/jobs/feeds.ts` builds every URL itself from a kind and a checked name, so nothing stored or in an advert can point a request elsewhere. LinkedIn, Indeed, Glassdoor and sites whose terms bar automation stay out: those go on a list to check by hand, and a form takes pasted adverts.
- **There is no scheduler yet.** The page checks the feeds when the last read is over 12 hours old, or on request.
- **Adverts are read by rules, with no model and no API key.** `extract.ts` finds the sections and `skills.ts` is a hand-kept skill list, because public taxonomies do not cover this field. Every requirement keeps the line it came from, so it can be checked by eye. The limit is that an unlisted skill cannot be seen, so the Skills tab also lists the terms adverts keep requiring that are not on the list.
- **Fit is the worst must-have, never an average.** Ready, On your plan, One gap or Stretch. There is no percentage, because a percentage hides which requirement is missing. Interest and fit stay separate, and only you set interest.
- **Evidence is computed.** Reading a unit is Studied, exercises or a finished milestone are Practised, a result with a commit is Measured, and work anyone can see is Public. Only Practised and above count as evidence.
- **A role closes on good evidence.** It must be missing from two good reads in a row. A failed, partial or empty read closes nothing, and closed adverts keep their text.
- **Advert text is untrusted.** It renders as plain text. The job RPCs take no connector token and anonymous callers have no access, so the Claude connector cannot read an advert. Employers and applications are private, so they live in the database, not in this public repo.

## Layout

```text
src/
  app/          Pages, server actions and API routes. Folders match the URLs.
  components/   UI shared between pages.
  lib/
    auth/       Who is signed in and what they may do.
    calendar/   Google Calendar: life blocks and study time.
    config/     Environment, projects and the list of tools.
    jobs/       Job feeds, reading adverts, the skill list and matching.
    lab/        The renderer guide behind /lab, and the shader model.
    library/    The book library: search, reading and the PDF.
    connector/  The Claude connector (MCP and OAuth).
    dates/      Weeks and time zones.
    portal/     What pages show, and every change the portal makes.
    study/      The study plans for each book and the renderer, reviews and results.
    supabase/   Supabase clients.
    tasks/      The task model, both backends and the switch between them.
scripts/       One-off loaders, such as the book.
supabase/       Migrations, database tests and auth config.
docs/           Setup and launch guides.
```

Tests sit next to the code they cover, as `*.test.ts`.

Setup: [docs/SETUP.md](docs/SETUP.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test              # unit tests, including the shader model and book search
supabase test db      # pgTAP tests for access rules
```
