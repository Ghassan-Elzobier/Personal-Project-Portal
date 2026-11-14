import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, dailySeries, devices, frames } from "./dashboard.ts";
import { contextLabel, deviceLabel, sourceLabel } from "./display.ts";
import { decide, shouldAutofix, type ErrorGroup, type IssueState } from "./issue.ts";

// Made-up data, shaped like error_list and error_detail. The errors page shows
// what the triage files, so the words are shared.

const NOW = new Date("2026-11-16T09:30:00Z");

test("dailySeries fills the last days up to today, oldest first, with zero where nothing happened", () => {
  const daily = [
    { day: "2026-11-10", occurrences: 9 },
    { day: "2026-11-14", occurrences: 2 },
    { day: "2026-11-16", occurrences: 3 },
  ];
  assert.deepEqual(dailySeries(daily, "2026-11-16", 4), [
    { day: "2026-11-13", count: 0 },
    { day: "2026-11-14", count: 2 },
    { day: "2026-11-15", count: 0 },
    { day: "2026-11-16", count: 3 },
  ]);
  assert.equal(dailySeries([], "2026-11-16", 14).length, 14);
});

test("ago says how long ago, in the words a person would use", () => {
  assert.equal(ago("2026-11-16T09:29:40Z", NOW), "just now");
  assert.equal(ago("2026-11-16T09:05:00Z", NOW), "25 min ago");
  assert.equal(ago("2026-11-16T06:30:00Z", NOW), "3 h ago");
  assert.equal(ago("2026-11-15T08:00:00Z", NOW), "yesterday");
  assert.equal(ago("2026-11-12T08:00:00Z", NOW), "4 days ago");
  assert.equal(ago("2026-10-01T08:00:00Z", NOW), "1 Oct");
  assert.equal(ago("2026-11-16T10:00:00Z", NOW), "just now");
});

test("devices counts each device seen, the most common first", () => {
  const event = (browser: string, device = "phone") => ({ browser, os: "Android 15", device, viewport: "412x915" });
  assert.deepEqual(devices([event("Chrome 131"), event("Firefox 133", "desktop"), event("Chrome 131")]), [
    { label: "Chrome 131 on Android 15, phone", count: 2 },
    { label: "Firefox 133 on Android 15, desktop", count: 1 },
  ]);
  assert.deepEqual(devices([{ browser: null, os: null, device: "unknown", viewport: null }]), [
    { label: "Unknown device", count: 1 },
  ]);
});

test("frames link the app's own code to GitHub at the release, and leave the rest plain", () => {
  const stack =
    "at MealCard (src/app/life/meal-card.tsx:42:7)\nat renderWithHooks (node_modules/react-dom/cjs/react-dom.js:10:20)";
  assert.deepEqual(frames(stack, "abcdef1", "example/portal"), [
    {
      text: "at MealCard (src/app/life/meal-card.tsx:42:7)",
      own: true,
      href: "https://github.com/example/portal/blob/abcdef1/src/app/life/meal-card.tsx#L42",
    },
    { text: "at renderWithHooks (node_modules/react-dom/cjs/react-dom.js:10:20)", own: false, href: null },
  ]);
  assert.equal(frames(stack, null, "example/portal")[0].href, null);
  assert.equal(frames(stack, "abcdef1", null)[0].href, null);
  assert.deepEqual(frames("", "abcdef1", "example/portal"), []);
});

test("the shared words say where an error came from", () => {
  assert.equal(sourceLabel("connector"), "the Claude connector");
  assert.equal(contextLabel("tool log_meal"), "in the connector tool log_meal");
  assert.equal(contextLabel("test"), "a test from the errors page");
  assert.equal(deviceLabel({ browser: null, os: null, device: "unknown", viewport: null }), null);
});

const filed: ErrorGroup = {
  fingerprint: "0123456789abcdef0123456789abcdef",
  source: "server",
  name: "TypeError",
  message: "x",
  route: "/life",
  context: "render",
  stack: "",
  release: null,
  occurrences: 1,
  first_seen: "2026-11-14T09:30:00Z",
  last_seen: "2026-11-14T09:30:00Z",
  status: "filed",
  issue_number: 12,
  synced_at: "2026-11-14T10:00:00Z",
};
const open: IssueState = { state: "OPEN", stateReason: null, labels: [] };
const closed: IssueState = { state: "CLOSED", stateReason: "NOT_PLANNED", labels: [] };

test("decide closes the issue of a bug ignored on the errors page, and reopens one restored there", () => {
  assert.deepEqual(decide({ ...filed, status: "ignored", synced_at: null }, open, null), { kind: "close" });
  assert.deepEqual(decide({ ...filed, status: "ignored", synced_at: null }, closed, null), { kind: "ignore" });
  assert.deepEqual(decide({ ...filed, synced_at: null }, closed, null), { kind: "restore" });
  assert.deepEqual(decide({ ...filed, synced_at: null }, open, null), { kind: "update" });
  assert.deepEqual(decide(filed, closed, null), { kind: "ignore" });
});

test("decide never files a test error, and a restored bug is not handed to Claude again", () => {
  assert.deepEqual(decide({ ...filed, status: "new", issue_number: null, context: "test" }, null, null), {
    kind: "ignore",
  });
  assert.equal(shouldAutofix({ kind: "restore" }, [], 0, 2), false);
  assert.equal(shouldAutofix({ kind: "close" }, [], 0, 2), false);
});
