import { test } from "node:test";
import assert from "node:assert/strict";
import { studyWeek } from "./study-week.ts";
import type { Block } from "./schedule.ts";

// The Schedule's study line: logged plus still to come, against the week's target.
// Made-up tasks.

const TODAY = "2026-11-18";
const at = (h: number, m = 0) => h * 60 + m;
const NOW = at(10);

const block = (id: string, over: Partial<Block> = {}): Block => ({
  id: `${id}:${TODAY}`,
  source: "asana",
  title: "Example chapter",
  date: TODAY,
  start: at(14),
  end: at(16),
  url: `/tasks?task=${id}`,
  editable: true,
  taskGid: id,
  ...over,
});

const week = (blocks: Block[], extra: Partial<Parameters<typeof studyWeek>[0]> = {}) =>
  studyWeek({ blocks, missed: new Set(), logs: [], logged: 0, target: 20, today: TODAY, now: NOW, ...extra });

test("Life and Google blocks are not study", () => {
  const w = week([
    block("a"),
    block("g", { source: "google" }),
    block("p", { source: "plan" }),
    block("s", { source: "session", start: at(18), end: at(19) }),
  ]);
  assert.equal(w.toCome, 3);
});

test("a completed or ended block is not still to come", () => {
  const w = week([
    block("done", { completed: true }),
    block("ended", { start: at(8), end: at(9) }),
    block("yesterday", { date: "2026-11-17" }),
    block("tomorrow", { date: "2026-11-19" }),
  ]);
  assert.equal(w.toCome, 2);
  assert.equal(w.missed, 0);
});

test("missed ids add to the missed hours, not to what is to come", () => {
  const ended = block("m", { start: at(7), end: at(8, 30) });
  const w = week([ended, block("a")], { missed: new Set([ended.id]) });
  assert.equal(w.missed, 1.5);
  assert.equal(w.toCome, 2);
});

test("a block under way with a session logged since it began is counted once, as logged", () => {
  const running = block("r", { start: at(9), end: at(11) });
  assert.equal(week([running]).toCome, 2);
  const logged = week([running], { logs: [{ taskGid: "r", date: TODAY, minutes: at(9, 45) }], logged: 0.75 });
  assert.equal(logged.toCome, 0);
  assert.equal(logged.logged, 0.75);
  // A session logged before the block began was other work.
  assert.equal(week([running], { logs: [{ taskGid: "r", date: TODAY, minutes: at(8) }] }).toCome, 2);
});

test("short and over against the target", () => {
  const short = week([block("a")], { logged: 6 });
  assert.equal(short.short, 12);
  assert.equal(short.over, 0);
  const over = week([block("a")], { logged: 19.5 });
  assert.equal(over.short, 0);
  assert.equal(over.over, 1.5);
  const covered = week([block("a")], { logged: 18 });
  assert.equal(covered.short, 0);
  assert.equal(covered.over, 0);
});

test("no target, no short or over", () => {
  const w = week([block("a")], { logged: 3, target: null });
  assert.equal(w.short, null);
  assert.equal(w.over, null);
  assert.equal(w.logged, 3);
  assert.equal(w.toCome, 2);
});
