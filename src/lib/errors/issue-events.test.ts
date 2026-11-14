import { test } from "node:test";
import assert from "node:assert/strict";
import { issueBody, sourceLinks, type ErrorGroup, type LatestEvent } from "./issue.ts";

// Made-up data, shaped like portal.errors_to_triage() and portal.latest_error_event().
const SHA = "4c83117aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5";
const group: ErrorGroup = {
  fingerprint: "0123456789abcdef0123456789abcdef",
  source: "browser",
  name: "TypeError",
  message: "Cannot read properties of undefined (reading 'title')",
  route: "/life/recipes/[key]",
  context: "uncaught",
  stack: [
    "at MealCard (src/app/life/recipes/[key]/meal-card.tsx:42:7)",
    "at src/app/(main)/layout.tsx:9:3",
    "at renderWithHooks (node_modules/react-dom/cjs/react-dom.js:10:20)",
    "at MealCard (src/app/life/recipes/[key]/meal-card.tsx:42:7)",
  ].join("\n"),
  release: SHA,
  occurrences: 2,
  first_seen: "2026-11-14T09:30:00Z",
  last_seen: "2026-11-14T10:02:00Z",
  status: "new",
  issue_number: null,
};
const latest: LatestEvent = {
  occurred_at: "2026-11-14T10:02:00Z",
  release: SHA,
  browser: "Chrome 131",
  os: "Android 15",
  device: "phone",
  viewport: "412x915",
  breadcrumbs: [
    { at: "2026-11-14T10:01:50.000Z", kind: "navigation", text: "push → /life/recipes/[key]" },
    { at: "2026-11-14T10:01:58.000Z", kind: "click", text: "button.btn-primary" },
    { at: "2026-11-14T10:01:59.000Z", kind: "action", text: "server action on /life/recipes/[key] → 500 (182 ms)" },
  ],
};

test("sourceLinks links the app's own frames to their lines at the release, once each", () => {
  assert.deepEqual(sourceLinks(group.stack, SHA, "example/portal"), [
    `- [\`src/app/life/recipes/[key]/meal-card.tsx:42\`](https://github.com/example/portal/blob/${SHA}/src/app/life/recipes/%5Bkey%5D/meal-card.tsx#L42)`,
    `- [\`src/app/(main)/layout.tsx:9\`](https://github.com/example/portal/blob/${SHA}/src/app/%28main%29/layout.tsx#L9)`,
  ]);
  assert.deepEqual(sourceLinks(group.stack, null, "example/portal"), []);
  assert.deepEqual(sourceLinks("at a (/_next/static/chunks/0abc.js:1:2)", SHA, "example/portal"), []);
});

test("issueBody shows the device, the source lines and what happened before", () => {
  const body = issueBody(group, "example/portal", latest);
  assert.match(body, /\| Last seen on \| Chrome 131 on Android 15, phone, 412×915 \|/);
  assert.match(body, /\*\*Source\*\* at this release:\n\n- \[`src\/app\/life\/recipes\/\[key\]\/meal-card\.tsx:42`\]/);
  assert.match(body, /\*\*What happened before\*\*/);
  assert.match(
    body,
    /```text\n10:01:50 navigation push → \/life\/recipes\/\[key\]\n10:01:58 click      button\.btn-primary\n10:01:59 action     server action on/,
  );
});

test("issueBody keeps to the last ten breadcrumbs, and leaves out what it does not have", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({
    at: `2026-11-14T10:01:${String(i).padStart(2, "0")}.000Z`,
    kind: "navigation",
    text: `push → /p${i}`,
  }));
  const body = issueBody(group, "example/portal", { ...latest, breadcrumbs: many });
  assert.doesNotMatch(body, /\/p3\n/);
  assert.match(body, /\/p4\n/);
  assert.match(body, /\/p13\n/);
  const bare = issueBody({ ...group, stack: "", release: null }, "example/portal", {
    ...latest,
    browser: null,
    os: null,
    device: "unknown",
    viewport: null,
    breadcrumbs: [],
  });
  assert.doesNotMatch(bare, /Last seen on|\*\*Source\*\*|What happened before/);
});
