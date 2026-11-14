import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, fixAttempts, shouldAttemptFix, FIX_MARKER } from "./failure.ts";

// Excerpts of real failed CI logs (with timestamps and job prefixes stripped).

const PORT_CLASH =
  'failed to start docker container "supabase_db_personal-project-portal": Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint x: failed to bind host port 0.0.0.0:55422/tcp: address already in use\nfailed to start containers: 18e685d3';
const FONT_TIMEOUT =
  "Warning: Error while requesting resource\nConnection timed out when requesting https://fonts.gstatic.com/s/funneldisplay/v3/B50WF7.woff2\n> Build error occurred";
const PLAYWRIGHT =
  "  ✘  2 [pixel-7] › e2e/tasks-view.spec.ts:7:1 › List and Board switch back and forth (6.7s)\n    Error: expect(page).not.toHaveURL(expected) failed\n    Expected pattern: not /view=board/";
const TYPES =
  "src/lib/tasks/tasks-href.test.ts(3,27): error TS2307: Cannot find module './tasks-href.ts'.\nFailed to type check.";
const LINT =
  "/work/src/app/x.tsx\n  31:16  error  'browserName' is defined but never used  @typescript-eslint/no-unused-vars";
const FORMAT =
  "Checking formatting...\n[warn] src/app/errors/page.tsx\n[warn] Code style issues found in 1 file. Run Prettier with --write to fix.";
const GUARD =
  "Guard: 3 problem(s) against origin/main\n\n- e2e/__screenshots__/visual.spec.ts/design-pixel-7.png: an existing test or screenshot changed.";
const DB = "not ok 4 - an unknown source is refused\n# Failed test 4";

test("known infrastructure failures are told apart, so they are rerun, not fixed", () => {
  for (const log of [
    PORT_CLASH,
    FONT_TIMEOUT,
    "toomanyrequests: You have reached your pull rate limit",
    "ECONNRESET reading from registry",
  ]) {
    assert.equal(classifyFailure(log).kind, "infrastructure", log.slice(0, 40));
  }
  assert.match(classifyFailure(PORT_CLASH).reason, /port.*already in use/i);
});

test("real failures are named by what failed", () => {
  assert.equal(classifyFailure(PLAYWRIGHT).kind, "e2e");
  assert.equal(classifyFailure(TYPES).kind, "types");
  assert.equal(classifyFailure(LINT).kind, "lint");
  assert.equal(classifyFailure(FORMAT).kind, "format");
  assert.equal(classifyFailure(GUARD).kind, "guard");
  assert.equal(classifyFailure(DB).kind, "database");
  assert.equal(classifyFailure("something odd").kind, "unknown");
  assert.equal(classifyFailure("").reason, "the run's log is not available");
});

test("a real failure wins over an infrastructure word that appears beside it", () => {
  assert.equal(classifyFailure(`${PLAYWRIGHT}\nECONNRESET in an unrelated retry`).kind, "e2e");
});

test("the excerpt is the lines that matter, bounded, and never the whole log", () => {
  const { excerpt } = classifyFailure(`${"noise\n".repeat(500)}${TYPES}\n${"more noise\n".repeat(500)}`);
  assert.match(excerpt, /error TS2307/);
  assert.ok(excerpt.length <= 3000);
});

test("fixAttempts counts the triage's earlier fix comments", () => {
  assert.equal(fixAttempts(["hello", `${FIX_MARKER} first`, `${FIX_MARKER} second`]), 2);
});

test("a fix is tried only on the owner's own branches, for real failures, twice at most", () => {
  const base = {
    branch: "claude/tasks",
    sameRepo: true,
    kind: "e2e" as const,
    attempts: 0,
    labels: [] as string[],
    excerpt: "✘ a test",
  };
  assert.equal(shouldAttemptFix(base), true);
  assert.equal(shouldAttemptFix({ ...base, attempts: 2 }), false);
  assert.equal(shouldAttemptFix({ ...base, kind: "infrastructure" }), false);
  assert.equal(shouldAttemptFix({ ...base, kind: "guard" }), false);
  assert.equal(shouldAttemptFix({ ...base, branch: "feature/x" }), false);
  assert.equal(shouldAttemptFix({ ...base, sameRepo: false }), false);
  assert.equal(shouldAttemptFix({ ...base, labels: ["no-autofix"] }), false);
  assert.equal(shouldAttemptFix({ ...base, excerpt: "" }), false);
});
