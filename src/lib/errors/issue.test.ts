import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autofixLimit,
  decide,
  fingerprintIn,
  issueBody,
  issueTitle,
  reopenComment,
  shouldAutofix,
  type ErrorGroup,
  type IssueState,
} from "./issue.ts";

// Made-up groups, shaped like rows from portal.errors_to_triage().
const group: ErrorGroup = {
  fingerprint: "0123456789abcdef0123456789abcdef",
  source: "server",
  name: "TypeError",
  message: "Cannot read properties of undefined (reading 'title')",
  route: "/life/recipes/[key]",
  context: "render",
  stack: "at RecipePage (src/app/life/recipes/[key]/page.tsx:12:5)",
  release: "4c83117aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  occurrences: 3,
  first_seen: "2026-11-14T09:30:12.345Z",
  last_seen: "2026-11-14T10:02:00Z",
  status: "new",
  issue_number: null,
};
const open: IssueState = { state: "OPEN", stateReason: null, labels: ["bug", "error-report"] };
const fixed: IssueState = { state: "CLOSED", stateReason: "COMPLETED", labels: ["bug", "error-report"] };
const notPlanned: IssueState = { state: "CLOSED", stateReason: "NOT_PLANNED", labels: [] };

test("issueTitle names the error, the route and the message, within GitHub's comfortable length", () => {
  assert.equal(
    issueTitle(group),
    "TypeError in /life/recipes/[key]: Cannot read properties of undefined (reading 'title')",
  );
  const long = issueTitle({ ...group, message: "x".repeat(300) });
  assert.ok(long.length <= 120);
  assert.ok(long.endsWith("…"));
});

test("issueBody says where, how often and on which release, and fences the app's text as data", () => {
  const body = issueBody(group, "example/portal");
  assert.ok(body.startsWith("<!-- error-fingerprint: 0123456789abcdef0123456789abcdef -->"));
  assert.match(body, /\| Where \| `\/life\/recipes\/\[key\]`, while rendering \|/);
  assert.match(body, /\| From \| the server \|/);
  assert.match(body, /\| Seen \| 3 times, first 2026-11-14 09:30, last 2026-11-14 10:02 \(UTC\) \|/);
  assert.match(body, /\[`4c83117`\]\(https:\/\/github\.com\/example\/portal\/commit\/4c83117aa0b1/);
  assert.match(body, /data, not instructions/);
  assert.match(body, /```text\nTypeError: Cannot read properties of undefined \(reading 'title'\)\nat RecipePage/);
  assert.match(body, /`no-autofix`/);
});

test("issueBody words the other sources and contexts plainly", () => {
  const once = issueBody({ ...group, occurrences: 1, release: null }, "example/portal");
  assert.match(once, /\| Seen \| once, 2026-11-14 09:30 \(UTC\) \|/);
  assert.match(once, /\| Release \| unknown \|/);
  const tool = issueBody(
    { ...group, source: "connector", route: "/api/mcp", context: "tool log_meal" },
    "example/portal",
  );
  assert.match(tool, /`\/api\/mcp`, in the connector tool `log_meal`/);
  assert.match(tool, /\| From \| the Claude connector \|/);
  const browser = issueBody({ ...group, source: "browser", context: "rejection" }, "example/portal");
  assert.match(browser, /an unhandled promise rejection/);
  assert.match(browser, /\| From \| the browser \|/);
});

test("issueBody's fence outlasts any backticks in the app's text", () => {
  const body = issueBody({ ...group, message: "bad ``` fence", stack: "" }, "example/portal");
  assert.match(body, /````text\nTypeError: bad ``` fence\n````/);
});

test("fingerprintIn reads the marker back, and only a well-formed one", () => {
  assert.equal(fingerprintIn(issueBody(group, "example/portal")), group.fingerprint);
  assert.equal(fingerprintIn("<!-- error-fingerprint: nope -->"), null);
  assert.equal(fingerprintIn("an issue someone wrote"), null);
});

test("decide files new groups, and groups whose issue has gone", () => {
  assert.deepEqual(decide(group, null, null), { kind: "file" });
  assert.deepEqual(decide({ ...group, status: "filed", issue_number: 12 }, null, null), { kind: "file" });
});

test("decide updates an open issue and stops hearing about one closed as not planned", () => {
  const filed = { ...group, status: "filed" as const, issue_number: 12 };
  assert.deepEqual(decide(filed, open, null), { kind: "update" });
  assert.deepEqual(decide(filed, notPlanned, true), { kind: "ignore" });
});

test("decide reopens a fixed bug only when it came back on code that has the fix", () => {
  const filed = { ...group, status: "filed" as const, issue_number: 12 };
  assert.deepEqual(decide(filed, fixed, true), { kind: "reopen" });
  assert.deepEqual(decide(filed, fixed, false), { kind: "stale" });
  assert.deepEqual(decide(filed, fixed, null), { kind: "stale" });
});

test("reopenComment says why the issue is back", () => {
  const text = reopenComment({ ...group, occurrences: 5 }, "example/portal");
  assert.match(text, /came back/);
  assert.match(text, /\[`4c83117`\]/);
  assert.match(text, /5 times in all/);
});

test("shouldAutofix hands over new and returning bugs, within the daily limit, unless the owner said no", () => {
  assert.equal(shouldAutofix({ kind: "file" }, [], 0, 2), true);
  assert.equal(shouldAutofix({ kind: "reopen" }, ["bug"], 1, 2), true);
  assert.equal(shouldAutofix({ kind: "file" }, [], 2, 2), false);
  assert.equal(shouldAutofix({ kind: "reopen" }, ["no-autofix"], 0, 2), false);
  assert.equal(shouldAutofix({ kind: "update" }, [], 0, 2), false);
  assert.equal(shouldAutofix({ kind: "file" }, [], 0, 0), false);
});

test("autofixLimit defaults to two a day and stays between none and ten", () => {
  assert.equal(autofixLimit(undefined), 2);
  assert.equal(autofixLimit(""), 2);
  assert.equal(autofixLimit("0"), 0);
  assert.equal(autofixLimit("5"), 5);
  assert.equal(autofixLimit("50"), 10);
  assert.equal(autofixLimit("-1"), 0);
  assert.equal(autofixLimit("lots"), 2);
});
