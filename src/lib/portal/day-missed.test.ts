import { test } from "node:test";
import assert from "node:assert/strict";
import { missedBlocks, yourDay, type Kept, type SessionLog } from "./day.ts";
import type { Block } from "./schedule.ts";

// A missed study block: it has ended, its task is not done, and nothing was logged
// for that task since it began. Today offers it the next free time. Made-up tasks.

const TODAY = "2026-11-16";
const TOMORROW = "2026-11-17";
const at = (h: number, m = 0) => h * 60 + m;

const study = (over: Partial<Block> = {}): Block => ({
  id: "t1:2026-11-16",
  source: "asana",
  title: "Ch 3 Multidimensional grids",
  date: TODAY,
  start: at(7),
  end: at(8),
  url: "/tasks?task=t1",
  editable: true,
  project: "PMPP 5e",
  taskGid: "t1",
  ...over,
});
const event = (date: string, start: number, end: number, id = `e${start}`): Block => ({
  id: `${id}:${date}`,
  source: "google",
  title: "Example event",
  date,
  start,
  end,
  url: "https://calendar.example.test/e",
  editable: false,
});
const kept = (logs: SessionLog[] = [], lastDay = "2026-11-22"): Kept => ({ logs, lastDay });
const log = (taskGid: string, minutes: number, date = TODAY): SessionLog => ({ taskGid, date, minutes });
const first = (blocks: Block[], now: number, k: Kept | null = kept()) =>
  yourDay(TODAY, blocks, null, now, k).items.find((i) => i.kind === "study");

test("a study block that ended with nothing logged for its task is missed", () => {
  const item = first([study()], at(9, 30));
  assert.equal(item?.missed, true);
});

test("a block still to come, or still running, is not missed", () => {
  assert.equal(first([study({ start: at(10), end: at(11) })], at(9, 30))?.missed, undefined);
  assert.equal(first([study({ start: at(9), end: at(10) })], at(9, 30))?.missed, undefined);
  // It ends on the minute it is now: over.
  assert.equal(first([study({ start: at(8, 30), end: at(9, 30) })], at(9, 30))?.missed, true);
});

test("a session logged for its task since it began means it was kept, and so does a finished task", () => {
  assert.equal(first([study()], at(9, 30), kept([log("t1", at(8, 5))]))?.missed, undefined);
  assert.equal(first([study()], at(9, 30), kept([log("t1", at(7))]))?.missed, undefined, "logged as it began");
  assert.equal(first([study({ completed: true })], at(9, 30))?.missed, undefined);
});

test("a session logged before the block began, for another task, or on another day does not count", () => {
  assert.equal(first([study()], at(9, 30), kept([log("t1", at(6, 30))]))?.missed, true);
  assert.equal(first([study()], at(9, 30), kept([log("t2", at(8, 5))]))?.missed, true);
  assert.equal(first([study()], at(9, 30), kept([log("t1", at(8, 5), "2026-11-15")]))?.missed, true);
});

test("the offer is the next free time today, for the block's own length", () => {
  const item = first([study(), event(TODAY, at(10), at(11))], at(9, 20));
  // Half past nine is free, but an hour from there runs into the event: after it, then.
  assert.deepEqual(item?.move, {
    source: "asana",
    id: "t1",
    date: TODAY,
    start: at(11),
    duration: 60,
    label: "Move to 11:00",
  });
  // With nothing in the way: the next quarter hour.
  assert.equal(first([study()], at(9, 20))?.move?.label, "Move to 09:30");
});

test("when today is full it is tomorrow morning, and only when tomorrow's blocks are known", () => {
  const full = [study(), event(TODAY, at(9), at(24)), event(TOMORROW, at(9), at(10))];
  assert.deepEqual(first(full, at(9, 30))?.move, {
    source: "asana",
    id: "t1",
    date: TOMORROW,
    start: at(10),
    duration: 60,
    label: "Tomorrow 10:00",
  });
  // On the last day Today holds, tomorrow can't be offered: the block is missed, with no move.
  const sunday = first(full, at(9, 30), kept([], TODAY));
  assert.equal(sunday?.missed, true);
  assert.equal(sunday?.move, undefined);
});

test("a study session on a task moves as a session, by its own id", () => {
  const session = study({ id: "ev42:2026-11-16", source: "session" });
  assert.deepEqual(first([session], at(9, 20))?.move, {
    source: "session",
    id: "ev42",
    date: TODAY,
    start: at(9, 30),
    duration: 60,
    label: "Move to 09:30",
  });
});

test("two missed blocks are never offered the same time", () => {
  const blocks = [
    study({ id: "t1:2026-11-16", taskGid: "t1", start: at(6), end: at(7) }),
    study({ id: "t2:2026-11-16", taskGid: "t2", start: at(7), end: at(8) }),
  ];
  const moves = yourDay(TODAY, blocks, null, at(9, 30), kept())
    .items.filter((i) => i.kind === "study")
    .map((i) => i.move?.label);
  assert.deepEqual(moves, ["Move to 09:30", "Move to 10:30"]);
});

test("a block the owner can't edit is missed but gets no offer, and without the logs nothing is called missed", () => {
  const locked = first([study({ editable: false })], at(9, 30));
  assert.equal(locked?.missed, true);
  assert.equal(locked?.move, undefined);
  const unknown = first([study()], at(9, 30), null);
  assert.equal(unknown?.missed, undefined);
  assert.equal(unknown?.move, undefined);
});

test("a missed block is not what comes next", () => {
  const day = yourDay(
    TODAY,
    [study(), study({ id: "t2:2026-11-16", taskGid: "t2", start: at(14), end: at(15) })],
    null,
    at(9, 30),
    kept(),
  );
  assert.equal(day.nextKey, "t2:2026-11-16");
});

test("the Schedule's rule is the same one, and it reaches back over the days gone", () => {
  const blocks = [
    study({ id: "t1:2026-11-14", date: "2026-11-14", start: at(14), end: at(15) }), // Saturday, nothing logged
    study({ id: "t2:2026-11-15", taskGid: "t2", date: "2026-11-15", start: at(14), end: at(15) }), // Sunday, logged at 14:40
    study({ id: "t3:2026-11-16", taskGid: "t3", start: at(7), end: at(8) }), // today, gone
    study({ id: "t4:2026-11-16", taskGid: "t4", start: at(14), end: at(15) }), // today, to come
    study({ id: "t5:2026-11-17", taskGid: "t5", date: TOMORROW }), // tomorrow
    study({ id: "t6:2026-11-14", taskGid: "t6", date: "2026-11-14", completed: true }), // done
    event("2026-11-14", at(9), at(10)), // not study
  ];
  const logs = [log("t2", at(14, 40), "2026-11-15"), log("t1", at(9), "2026-11-15")];
  assert.deepEqual([...missedBlocks(blocks, TODAY, at(9, 30), logs)].sort(), ["t1:2026-11-14", "t3:2026-11-16"]);
  assert.deepEqual([...missedBlocks(blocks, TODAY, at(6), logs)], ["t1:2026-11-14"], "before today's block has begun");
});
