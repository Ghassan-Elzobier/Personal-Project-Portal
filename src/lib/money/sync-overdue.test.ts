import { test } from "node:test";
import assert from "node:assert/strict";
import { feedNote, parseMoney, syncOverdue } from "./state.ts";

// A connected bank whose syncs went quiet: made-up values, as money_read returns them.
const raw = {
  connection: { provider: "lunchflow", status: "active", last_data_at: null, created_at: "2026-11-17T09:00:00Z" },
  last_ok: "2026-11-18T00:00:00Z",
  failures: 0,
};

test("the feed says when the sync has stopped, worked out from the time now", () => {
  const s = parseMoney(raw);
  assert.equal(s.connection?.status, "active", "no sync ran, so nothing marked it stale");
  const note = feedNote(s, new Date("2026-11-18T13:00:00Z"));
  assert.equal(note?.tone, "warn");
  assert.match(note!.text, /last good bank sync was 13 h ago.*out of date/);
  assert.equal(feedNote(s, new Date("2026-11-18T02:00:00Z")), null);
});

test("a bank that never synced counts from when it was connected", () => {
  const s = parseMoney({ ...raw, last_ok: null });
  assert.match(feedNote(s, new Date("2026-11-18T09:00:00Z"))!.text, /hasn't synced yet/);
  assert.equal(feedNote(s, new Date("2026-11-17T10:00:00Z")), null, "just connected");
  assert.equal(syncOverdue(null, new Date(), null), false, "nothing to measure from");
});
