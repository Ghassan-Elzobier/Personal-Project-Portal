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
   src/lib/<domain>  study · tasks · life · jobs · lab · library · calendar
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
  (`config/`), access (`auth/`) and the Supabase clients.

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

- `tasks/native.ts`, `life/store.ts` and `library/book.ts` import `connectorCaller` and
  `anonClient` from the connector, to pick the right database client for a page
  or a Claude call. That choice is infrastructure: it belongs in `src/lib/supabase`,
  which removes the folder-level cycle between the connector and the domains.
- `study/load.ts` and `life/calendar-sync.ts` import from `portal`. Move the shared
  pieces down into their domains.
- Three pages import `tasks/native` directly (`/`, `/study`, `/tasks`), for reads the
  Asana backend does not offer. Add them to the tracker interface or move them
  behind `portal`.
- Hotspots: `connector/tools.ts`, `app/schedule/week-planner.tsx` and
  `portal/operations.ts` are each over 700 lines and change often. Split them by
  feature when next touched.
