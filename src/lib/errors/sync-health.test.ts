import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNC_MARKER, decideSync, syncHealthFrom, syncIssueBody } from "./sync-health.ts";

// Made-up rows, as SYNC_HEALTH_QUERY returns them.
const now = new Date("2026-11-20T12:00:00Z");
const row = {
  connected: true,
  connected_at: "2026-11-01T09:00:00Z",
  last_ok: "2026-11-19T18:00:00Z",
  runs: 3,
  failed: 2,
  last_code: "HTTP_503",
};

test("the triage files one issue when a connected bank's scheduled sync has stopped", () => {
  const h = syncHealthFrom(row);
  assert.equal(decideSync(h, now, false), "file");
  assert.equal(decideSync(h, now, true), "update", "an open issue is kept current, never filed twice");
});

test("the triage closes the issue once a newer good scheduled run exists", () => {
  const h = syncHealthFrom({ ...row, last_ok: "2026-11-20T11:00:00Z", runs: 0, failed: 0, last_code: null });
  assert.equal(decideSync(h, now, true), "close");
  assert.equal(decideSync(h, now, false), "none");
});

test("the triage does nothing when no bank is connected", () => {
  const h = syncHealthFrom({ connected: false, connected_at: null, last_ok: null, runs: 0, failed: 0 });
  assert.equal(decideSync(h, now, false), "none");
  assert.equal(decideSync(syncHealthFrom(undefined), now, false), "none");
});

test("a bank that never synced counts from when it was connected", () => {
  const h = syncHealthFrom({ ...row, last_ok: null, connected_at: "2026-11-20T06:00:00Z" });
  assert.equal(decideSync(h, now, false), "none", "connected 6 hours ago");
  assert.equal(decideSync(h, new Date("2026-11-21T06:00:00Z"), false), "file");
});

test("the issue says only durations, counts and codes, never amounts or names", () => {
  const leaky = {
    ...row,
    last_code: "Current account 5555 £1,234.56",
    pence: 123456,
    name: "Current account",
  };
  const body = syncIssueBody(syncHealthFrom(leaky), now);
  assert.ok(body.startsWith(SYNC_MARKER));
  assert.doesNotMatch(body, /£|pence|123456|1,234|5555|Current account/);
  assert.match(body, /18 hours/);
  assert.match(body, /3 \(2 failed\)/);
  assert.match(body, /Last error code \| none/, "a code that isn't a code is dropped");

  const coded = syncIssueBody(syncHealthFrom(row), now);
  const codes = [...coded.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.ok(codes.includes("HTTP_503"));
  for (const c of codes) assert.match(c, /^[A-Z0-9_]+$/);
  for (const n of coded.match(/\d[\d,.]*/g) ?? []) assert.ok(Number(n.replace(/[,.]$/, "")) < 1000, n);
});
