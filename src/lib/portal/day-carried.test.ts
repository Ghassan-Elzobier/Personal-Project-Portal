import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay, type Kept, type SessionLog } from "./day.ts";
import type { Block } from "./schedule.ts";

// A study block missed on an earlier day this week, still owed, is carried onto Today
// with a new time, so a miss is put back quickly instead of piling up. Made-up tasks.

const TODAY = "2026-11-18"; // Wednesday
const TUE = "2026-11-17";
const MON = "2026-11-16";
const at = (h: number, m = 0) => h * 60 + m;

const study = (task: string, date: string, start = at(14), over: Partial<Block> = {}): Block => ({
  id: `${task}:${date}`,
  source: "asana",
  title: `Chapter ${task}`,
  date,
  start,
  end: start + 60,
  url: `/tasks?task=${task}`,
  editable: true,
  project: "PMPP 5e",
  taskGid: task,
  ...over,
});
const kept = (logs: SessionLog[] = []): Kept => ({ logs, lastDay: "2026-11-22" });
const log = (taskGid: string, date: string, minutes: number): SessionLog => ({ taskGid, date, minutes });
const day = (blocks: Block[], now = at(9, 20), k: Kept | null = kept()) => yourDay(TODAY, blocks, null, now, k);

test("a study block missed on an earlier day is carried, with a move to the next free time today", () => {
  const d = day([study("t1", TUE)]);
  assert.equal(d.carried.length, 1);
  const [c] = d.carried;
  assert.equal(c.key, "t1:2026-11-17");
  assert.equal(c.missed, true);
  assert.equal(c.date, TUE, "its own day, for Undo");
  assert.equal(c.taskGid, "t1");
  assert.equal(c.detail, "PMPP 5e · 14:00 to 15:00");
  assert.deepEqual(c.move, {
    source: "asana",
    id: "t1",
    date: TODAY,
    start: at(9, 30),
    duration: 60,
    label: "Move to 09:30",
  });
  // It is not one of today's items.
  assert.equal(
    d.items.some((i) => i.key === c.key),
    false,
  );
  assert.equal(d.carriedMore, 0);
});

test("today's missed blocks are offered first, and a carried one never gets the same time", () => {
  const d = day([study("t1", TUE), study("t2", TODAY, at(7))]);
  assert.equal(d.items.find((i) => i.key === "t2:2026-11-18")?.move?.label, "Move to 09:30");
  assert.equal(d.carried[0].move?.label, "Move to 10:30");
});

test("no carried row for a task that is done, studied since, or already planned again", () => {
  assert.equal(day([study("t1", TUE, at(14), { completed: true })]).carried.length, 0, "completed");
  assert.equal(
    day([study("t1", TUE)], at(9, 20), kept([log("t1", TUE, at(14, 30))])).carried.length,
    0,
    "logged in it",
  );
  assert.equal(
    day([study("t1", MON)], at(9, 20), kept([log("t1", TUE, at(8))])).carried.length,
    0,
    "logged a day later",
  );
  assert.equal(day([study("t1", TUE), study("t1", "2026-11-20")]).carried.length, 0, "a block still to come");
  assert.equal(day([study("t1", TUE), study("t1", TODAY, at(16))]).carried.length, 0, "a block later today");
  assert.equal(day([study("t1", TUE), study("t1", TODAY, at(7))]).carried.length, 0, "already on Today, missed");
  // A session logged before the block began, or for another task, does not count.
  assert.equal(
    day([study("t1", TUE)], at(9, 20), kept([log("t1", TUE, at(8)), log("t2", TODAY, at(8))])).carried.length,
    1,
  );
  // Without the logs nothing is called missed.
  assert.equal(day([study("t1", TUE)], at(9, 20), null).carried.length, 0);
});

test("one row per task, its latest miss, and at most three rows, the rest counted", () => {
  const one = day([study("t1", MON), study("t1", TUE, at(16))]);
  assert.deepEqual(
    one.carried.map((c) => c.key),
    ["t1:2026-11-17"],
  );

  const many = day([
    study("t1", MON, at(8)),
    study("t2", MON, at(10)),
    study("t3", MON, at(12)),
    study("t4", TUE, at(8)),
    study("t5", TUE, at(10)),
  ]);
  assert.deepEqual(
    many.carried.map((c) => c.key),
    ["t3:2026-11-16", "t4:2026-11-17", "t5:2026-11-17"],
    "the latest three, oldest first",
  );
  assert.equal(many.carriedMore, 2);
  const times = many.carried.map((c) => c.move?.start);
  assert.equal(new Set(times).size, 3, "three different times");
});

test("a carried block the owner can't edit is listed without an offer", () => {
  const [c] = day([study("t1", TUE, at(14), { editable: false })]).carried;
  assert.equal(c.missed, true);
  assert.equal(c.move, undefined);
});
