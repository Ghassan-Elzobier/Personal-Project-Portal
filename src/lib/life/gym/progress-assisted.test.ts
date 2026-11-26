import { test } from "node:test";
import assert from "node:assert/strict";
import { e1rmSeries, target, type SetLog } from "./progress.ts";
import { lowestKg, MOST_HELP, workout } from "./program.ts";
import { setLabel } from "./next-set.ts";

// An assisted pull-up machine takes weight off, so its help is logged as negative
// kg: 35 kg of help is -35. Progress takes help away a step at a time, missing the
// range twice gives a step back, and the words say help rather than weight.

const pullUp = workout("B")!
  .blocks.flatMap((b) => b.items)
  .find((p) => p.exercise === "pull-up")!; // 4 sets of 6 to 10, 1 in reserve

const day = (date: string, kg: number, reps: number[], rir: number | null = null): SetLog[] =>
  reps.map((r, i) => ({ day: date, workout: "B", exercise: "pull-up", position: i + 1, kg, reps: r, rir }));

test("every set at the top of the range takes a step of help away", () => {
  const t = target(pullUp, day("2026-11-26", -35, [10, 10, 10, 10]), false);
  assert.equal(t.change, "up");
  assert.deepEqual(
    t.sets.map((s) => s.kg),
    [-32.5, -32.5, -32.5, -32.5],
  );
  assert.equal(t.why, "All sets hit 10: 2.5 kg less help.");
});

test("short of the top, the help stays the same", () => {
  const t = target(pullUp, day("2026-11-26", -35, [10, 9, 8, 8]), false);
  assert.equal(t.change, "same");
  assert.equal(t.sets[0].kg, -35);
  assert.equal(t.why, "Same help: aim for 9 on every set.");
});

test("below the range twice gives a step of help back, not 5% off", () => {
  const h = [...day("2026-11-24", -30, [5, 5, 4, 4]), ...day("2026-11-26", -30, [5, 4, 4, 4])];
  const t = target(pullUp, h, false);
  assert.equal(t.change, "down");
  assert.equal(t.sets[0].kg, -32.5);
  assert.equal(t.why, "Below the range twice: 2.5 kg more help.");
});

test("assisted sets never count towards an estimated max", () => {
  assert.deepEqual(e1rmSeries(day("2026-11-26", -35, [8, 8]), "pull-up"), []);
});

test("the next-set line names the help, and only a bodyweight move may go below zero", () => {
  const item = { name: "Pull-up", unit: "reps" as const, added: true, perSide: false };
  assert.equal(setLabel(item, 1, { kg: -35, reps: 8 }), "Pull-up · set 1 · 35 kg help × 8");
  assert.equal(setLabel(item, 1, { kg: 2.5, reps: 6 }), "Pull-up · set 1 · +2.5 kg × 6");
  assert.equal(lowestKg("pull-up"), -MOST_HELP);
  assert.equal(lowestKg("dips"), -MOST_HELP);
  assert.equal(lowestKg("bench"), 0);
  assert.equal(lowestKg("lat-pulldown"), 0);
});
