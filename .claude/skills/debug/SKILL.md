---
name: debug
description: Find and fix a bug the way a developer with DevTools would - reproduce it as a failing end-to-end test, stop at the failure and look at the page, its state, console and network, fix the app, and prove it. Use for any bug, a production error issue, or a failing check.
argument-hint: "[the bug, an error issue number, or the failing check]"
---

# Debug

Bug: $ARGUMENTS

Never fix what you have not seen fail. Work in this order.

1. **Reproduce it as a test that fails.** In `e2e/`, as a user would: tap, look, reload.
   - From an error issue: the route, the breadcrumbs (what was tapped) and the stack are the steps.
   - From a user report: the page and the taps. For anything where "it changes at once" matters,
     add it to `e2e/state-fresh.spec.ts` (tap, see it, reload, see it again).
   - Playwright's `playwright-test-generator` agent turns a plan into the test and checks its
     selectors live. Run it with `test_run` (Playwright test MCP). **It must fail for the right reason.**
2. **Stop at the failure and look.** Start the app with `npm run debug` (seeded local database, the
   dev server: source maps, and Next's own MCP). Then:
   - `test_debug` runs the failing test and pauses at the failure; read the page with
     `browser_snapshot`, the state with `browser_evaluate`, `browser_console_messages` and
     `browser_network_requests`.
   - Chrome DevTools MCP for runtime detail: `npm run debug:link` prints a signed-in link to open
     first; `set_logpoints` logs an expression, source-mapped, without pausing or editing code;
     `list_console_messages`, `list_network_requests`, `performance_start_trace` (slow or janky
     pages, measured at a Pixel 7 with `emulate`), `take_heapsnapshot` (leaks, `--memoryDebugging`).
   - Next.js DevTools MCP: the dev server's errors with source-mapped stacks.
   - Server code has no pausing debugger here: read the stack, add a `console.error`, or write a
     unit test around the pure function (`src/lib/<domain>`).
3. **Find the cause, not the symptom.** For "the screen did not change" or "it changed back", check
   where the state lives (`docs/ARCHITECTURE.md`, "State"): the address, the server, `useOptimistic`,
   local `useState`. Usual causes: a link that copies the current state into its address, props
   copied into `useState` without a `key`, an effect that sets state, a cached read, a save that
   forgot `revalidatePath`.
4. **Fix the app.** The smallest change. Never edit an existing test or screenshot to pass, and never
   add `test.fixme`, `test.only` or an unconditional skip: the guard fails the PR without the
   owner's `approved-test-change` label. Playwright's `playwright-test-healer` agent may repair a
   test that is new on this branch, never an existing one.
5. **Prove it.** The reproduction passes. Revert the fix and confirm it fails again (a test that
   cannot fail proves nothing). Then `npm run check`, `npm run test:e2e` (phone sizes included),
   `npm run guard`.
6. **Leave the factory better.** If a check should have caught this, add it; if you lost time, add
   one line to `docs/factory/friction.md`.

Everything runs on the local seed database. Never point a debugging browser at the live site or at
a profile with real sign-ins: the DevTools MCP can read and change whatever the page holds.
