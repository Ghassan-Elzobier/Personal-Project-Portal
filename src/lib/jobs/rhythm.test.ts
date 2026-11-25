import { test } from "node:test";
import assert from "node:assert/strict";
import { rhythmLine, searchRhythm, sentThisWeek } from "./rhythm.ts";
import type { Band } from "./match.ts";

// Made-up applications: the repository is public. 2026-11-25 is a Wednesday.
const TODAY = "2026-11-25";
const sent = (applied_on: string | null, stage = "applied", band: Band = "stretch") => ({
  applied_on,
  stage,
  fit: { band },
});

test("eight Monday weeks end with this week, and an empty week reads 0", () => {
  const rhythm = searchRhythm([], TODAY);
  assert.deepEqual(
    rhythm.weeks.map((w) => w.start),
    ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"],
  );
  assert.ok(rhythm.weeks.every((w) => w.sent === 0 && w.close === 0));
  assert.equal(rhythm.sent, 0);
});

test("each application lands in the week it was sent, Monday to Sunday", () => {
  const rhythm = searchRhythm([sent("2026-11-23"), sent("2026-11-22"), sent("2026-11-16"), sent("2026-10-05")], TODAY);
  assert.deepEqual(
    rhythm.weeks.map((w) => w.sent),
    [1, 0, 0, 0, 0, 0, 2, 1],
  );
  assert.equal(rhythm.sent, 4);
  assert.equal(sentThisWeek(rhythm), 1);
});

test("a role never sent, or sent before the eight weeks, is left out", () => {
  const rhythm = searchRhythm([sent(null, "saved"), sent("2026-10-04"), sent("2026-12-01")], TODAY);
  assert.equal(rhythm.sent, 0);
});

test("a rejected or passed role that was sent still counts", () => {
  const rhythm = searchRhythm([sent("2026-11-24", "rejected"), sent("2026-11-24", "passed")], TODAY);
  assert.equal(sentThisWeek(rhythm), 2);
});

test("close fits are only Ready and On your plan, and interviews are interview or offer", () => {
  const rhythm = searchRhythm(
    [
      sent("2026-11-24", "applied", "ready"),
      sent("2026-11-24", "interview", "by_date"),
      sent("2026-11-24", "offer", "one_gap"),
      sent("2026-11-24", "applied", "stretch"),
      sent("2026-11-24", "rejected", "unread"),
    ],
    TODAY,
  );
  assert.equal(rhythm.weeks.at(-1)?.close, 2);
  assert.equal(rhythm.close, 2);
  assert.equal(rhythm.interviews, 2);
});

test("a timestamp is read by its date", () => {
  assert.equal(sentThisWeek(searchRhythm([sent("2026-11-23T08:00:00Z")], TODAY)), 1);
});

test("the summary line reads as a record, with no target", () => {
  const rhythm = searchRhythm(
    [
      sent("2026-11-24", "interview", "ready"),
      sent("2026-11-10", "applied", "by_date"),
      sent("2026-10-20", "rejected", "stretch"),
    ],
    TODAY,
  );
  assert.equal(rhythmLine(rhythm), "3 sent in 8 weeks, 2 of them close fits, 1 now at interview or offer.");
  assert.equal(
    rhythmLine(searchRhythm([sent("2026-11-24", "applied", "ready")], TODAY)),
    "1 sent in 8 weeks, 1 of them a close fit, 0 now at interview or offer.",
  );
  assert.equal(rhythmLine(searchRhythm([], TODAY)), "None sent in the last 8 weeks.");
});
