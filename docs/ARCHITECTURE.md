# Architecture

The portal's layers and the rules that keep them apart. The rules marked
"enforced" are lint rules (`eslint.config.mjs`); breaches that predate them sit
in `eslint-suppressions.json` until the refactor queue removes them.

## Layers

```text
src/app (pages, server actions, routes)        src/lib/connector (Claude MCP server)
            │                                              │
            └──────────────┬───────────────────────────────┘
                           ▼
            src/lib/portal  what pages show, and every change the portal makes
                           │
                           ▼
   src/lib/<domain>  study · tasks · life · jobs · lab · library · calendar · errors
   pure logic with tests beside it, plus each domain's data access
                           │
                           ▼
   src/lib/dates · src/lib/config · src/lib/auth · src/lib/supabase  (infrastructure)
                           │
                           ▼
   Supabase: the private `portal` schema, reached only through `public` RPCs
```

- **Pages and the connector are siblings.** Both call `src/lib/portal`, after their
  own access check, so a button and a Claude tool can never allow different things
  (`src/lib/portal/operations.ts`).
- **Domains hold the logic.** Pure functions (planning, matching, progression,
  nutrition) are tested with node:test; I/O stays at the edges of the module.
- **Infrastructure knows nothing above it.** The clock (`dates/clock.ts`), settings
  (`config/`), access (`auth/`) and the Supabase clients. Domains call their RPCs
  through `rpcAsCaller` (`supabase/caller.ts`), which uses the browser session for a
  page and the token's hash for a Claude connector call.
- **Errors are tracked in production.** `src/instrumentation.ts` (server errors),
  `src/instrumentation-client.ts` and `app/error.tsx` (browser errors, through
  `/api/errors`) and the connector's tool handler all report to `src/lib/errors`.
  It maps stack frames back to source lines (`symbolicate.ts`, with the build's
  source maps read from disk), scrubs anything that could be personal, groups
  occurrences by fingerprint, and stores each one with its device and breadcrumbs
  through `record_error` (`portal.error_groups`, `error_events`, `error_daily`).
  The issues those groups become are public, so scrubbing happens before anything
  is stored.

## State

Where each kind of state lives, and the checks that hold it there. From an audit of all 38 client
components: most already followed this, and the exceptions are in the friction log.

| Kind | Lives in | Why |
| --- | --- | --- |
| Data (tasks, meals, weigh-ins) | The database, read by Server Components, changed by Server Actions that `revalidatePath` | One source of truth: a page can only be stale if a read is cached. |
| Which view, project, task or filter | The address (`?view=board&project=pmpp&task=12`) | Links, Back and reload all work. Every link names the view it goes to (`src/lib/tasks/tasks-href.ts`): the Tasks List button once copied the current view into its address and never switched back. |
| What a tap just did, before the server answers | `useOptimistic` | The screen changes at once, and snaps to the server's answer. |
| Form text and open/closed panels | Local `useState` in the component that owns it, keyed to its data (`key={task.gid}`) | A different record gets a fresh component, so nothing leaks between them. |
| Space (Work or Life), last pages | A cookie and `localStorage`, read with `useSyncExternalStore` | External stores are read, not copied into state by an effect. |

Rules that follow, enforced where a tool can:
- **No setState in an effect** (`react-hooks/set-state-in-effect`, no longer suppressed anywhere). Derive the value instead; reset state when a value changes by adjusting it while rendering, or key the component; read external stores with `useSyncExternalStore`.
- **Never copy props into state** without a key tied to the prop (reviewed: the three spots found are keyed).
- **A tap that changes data must be tested by tapping.** `e2e/state-fresh.spec.ts` taps each switch and save (Tasks views, search, add, tick, the open task, Work/Life, the Schedule's space, a weigh-in, Ignore) and checks the page at once and after a reload. It runs last and alone, creates uniquely named data, and deletes it again, because other suites' screenshots show that data. Add to it whenever a new switch or save is added.

## Rules

| Rule | Why | Enforced |
| --- | --- | --- |
| Pages never import a task backend (`tasks/native`, `tasks/asana`); they use `tasks/tracker` or `portal`. | `TASK_BACKEND=asana` must keep working. | Yes |
| Only `src/proxy.ts` uses `supabase/session`. | One place refreshes the session. | Yes |
| Domain code never imports the connector or the portal layer. | Imports point down, so there are no cycles and each domain tests alone. | Yes |
| No file-level import cycles. | Load order must not matter. | Yes (`import/no-cycle`) |
| Server code gets "now" from `dates/clock.ts`. | Tests can pin the day; one place to reason about time zones. | Review |
| Server-only modules import `server-only`. | Secrets and service code never reach the browser bundle. | Build |
| Access is decided in the database, by the RPCs. | The page, the connector and a direct API call all meet the same check. | pgTAP |

## Known debt

From `npm run health`, the structural items in the queue:

- `study/load.ts` and `life/calendar-sync.ts` import from `portal`. Move the shared
  pieces down into their domains.
- Three pages import `tasks/native` directly (`/`, `/study`, `/tasks`), for reads the
  Asana backend does not offer. Add them to the tracker interface or move them
  behind `portal`.
- Hotspots: `connector/tools.ts`, `app/schedule/week-planner.tsx` and
  `portal/operations.ts` are each over 700 lines and change often. Split them by
  feature when next touched.
