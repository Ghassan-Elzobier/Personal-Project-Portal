import { test } from "node:test";
import assert from "node:assert/strict";
import { LONG_GAP_DAYS, roundTo, target, type SetLog } from "./progress.ts";
import { workout } from "./program.ts";

// A lift last done more than four weeks ago starts lighter, with one more rep in
// reserve; four weeks or less changes nothing. Made-up sessions.

const item = (w: string, key: string) =>
  workout(w)!
    .blocks.flatMap((b) => b.items)
    .find((p) => p.exercise === key)!;
const bench = item("A", "bench"); // a top set and back-offs
const pullUp = item("B", "pull-up"); // straight sets, assisted here
const legRaise = item("A", "hanging-leg-raise"); // bodyweight, nothing to add

const TODAY = "2026-11-26";
const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const day = (date: string, exercise: string, w: string, kg: number | null, reps: number[]): SetLog[] =>
  reps.map((r, i) => ({ day: date, workout: w, exercise, position: i + 1, kg, reps: r, rir: null }));

test("a top set last done five weeks ago comes back 10% lighter, one more rep in reserve", () => {
  const h = [...day(daysAgo(35), "bench", "A", 80, [6]), ...day(daysAgo(35), "bench", "A", 72.5, [5, 5])];
  const t = target(bench, h, false, TODAY);
  assert.equal(t.change, "down");
  assert.equal(t.sets[0].kg, roundTo(80 * 0.9, 2.5));
  assert.equal(t.sets[0].reps, bench.reps[0]);
  assert.equal(t.sets[1].kg, 65); // 90% of 72.5, rounded down to the step
  assert.equal(t.rir, bench.rir + 1);
  assert.match(t.why, /5 weeks since you last did this/);
});

test("a gap of four weeks or less changes nothing", () => {
  for (const n of [20, LONG_GAP_DAYS]) {
    const h = [...day(daysAgo(n), "bench", "A", 80, [6]), ...day(daysAgo(n), "bench", "A", 72.5, [5, 5])];
    assert.deepEqual(target(bench, h, false, TODAY), target(bench, h, false));
  }
});

test("an assisted lift after a long gap gets a step more help", () => {
  const t = target(pullUp, day(daysAgo(35), "pull-up", "B", -30, [10, 10, 10, 10]), false, TODAY);
  assert.equal(t.change, "down");
  assert.deepEqual(
    t.sets.map((s) => [s.kg, s.reps]),
    Array.from({ length: pullUp.sets }, () => [-32.5, pullUp.reps[0]]),
  );
  assert.equal(t.rir, pullUp.rir + 1);
  assert.match(t.why, /more help/);
});

test("a bodyweight move after a long gap keeps the load and aims for the bottom of the range", () => {
  const t = target(legRaise, day(daysAgo(42), "hanging-leg-raise", "A", null, [12, 12, 12]), false, TODAY);
  assert.equal(t.change, "down");
  assert.ok(t.sets.every((s) => s.kg === null && s.reps === legRaise.reps[0]));
  assert.equal(t.rir, legRaise.rir + 1);
  assert.match(t.why, /6 weeks since/);
});

test("the session after coming back progresses as usual", () => {
  const h = [...day(daysAgo(40), "bench", "A", 80, [6]), ...day(daysAgo(2), "bench", "A", 72.5, [6])];
  assert.deepEqual(target(bench, h, false, TODAY), target(bench, h, false));
});
