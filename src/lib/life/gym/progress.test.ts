import { test } from "node:test";
import assert from "node:assert/strict";
import { consistency, e1rm, e1rmSeries, nextWorkout, project, target, type SetLog } from "./progress.ts";
import { EXERCISE_MAP, resolve, workout } from "./program.ts";

const item = (w: string, key: string) =>
  workout(w)!
    .blocks.flatMap((b) => b.items)
    .find((p) => p.exercise === key)!;
const bench = item("A", "bench");
const squat = item("A", "back-squat");
const pullUp = item("B", "pull-up");
const legRaise = item("A", "hanging-leg-raise");
const set = (
  day: string,
  exercise: string,
  position: number,
  kg: number,
  reps: number,
  rir: number | null = null,
): SetLog => ({ day, workout: "A", exercise, position, kg, reps, rir });

test("Epley with reps in reserve", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.ok(Math.abs(e1rm(80, 5, 2)! - 80 * (1 + 7 / 30)) < 1e-9);
  assert.equal(e1rm(60, 15), null);
});

test("the first time asks for a calibration set", () => {
  const t = target(bench, [], true);
  assert.equal(t.change, "new");
  assert.equal(t.sets[0].kg, null);
  assert.equal(t.rir, 3);
});

test("a top set at the top of the range adds a step, with back-offs at 90%", () => {
  const t = target(bench, [set("2026-11-13", "bench", 1, 60, 6), set("2026-11-13", "bench", 2, 55, 5)], false);
  assert.equal(t.change, "up");
  assert.equal(t.sets[0].kg, 62.5);
  assert.equal(t.sets[1].kg, 55);
  assert.equal(t.sets.length, 4);
});

test("straight sets go up only when every set hits the top", () => {
  const some = [1, 2, 3].map((i) => set("2026-11-13", "back-squat", i, 50, i === 3 ? 5 : 6));
  assert.equal(target(squat, some, false).change, "same");
  const all = [1, 2, 3].map((i) => set("2026-11-13", "back-squat", i, 50, 6));
  const up = target(squat, all, false);
  assert.equal(up.change, "up");
  assert.equal(up.sets[0].kg, 52.5);
});

test("missing the range twice takes 5% off", () => {
  const h = [
    ...[1, 2, 3].map((i) => set("2026-11-10", "back-squat", i, 60, 4)),
    ...[1, 2, 3].map((i) => set("2026-11-13", "back-squat", i, 60, 4)),
  ];
  const t = target(squat, h, false);
  assert.equal(t.change, "down");
  assert.equal(t.sets[0].kg, 57.5);
});

test("bodyweight moves add reps, then weight on a belt; core moves get harder, not heavier", () => {
  const some = [1, 2, 3, 4].map((i) => ({ ...set("2026-11-13", "pull-up", i, 0, 8), kg: null }));
  const same = target(pullUp, some, false);
  assert.equal(same.change, "same");
  assert.equal(same.sets[0].kg, null);
  assert.equal(same.sets[0].reps, 9);
  const all = [1, 2, 3, 4].map((i) => ({ ...set("2026-11-13", "pull-up", i, 0, 10), kg: null }));
  const up = target(pullUp, all, false);
  assert.equal(up.change, "up");
  assert.equal(up.sets[0].kg, 2.5);
  assert.match(up.why, /belt/);
  const raises = [1, 2, 3].map((i) => ({ ...set("2026-11-13", "hanging-leg-raise", i, 0, 12), kg: null }));
  const harder = target(legRaise, raises, false);
  assert.equal(harder.change, "same");
  assert.match(harder.why, /3 seconds/);
});

test("the programme never bends under load: no bent-over rows, Romanian deadlifts or back extensions", () => {
  const used = ["A", "B", "C"].flatMap((w) => workout(w)!.blocks.flatMap((b) => b.items.map((p) => p.exercise)));
  for (const banned of ["db-rdl", "back-extension", "one-arm-row"]) assert.ok(!used.includes(banned), banned);
  for (const key of used) assert.ok(EXERCISE_MAP.has(key), key);
});

test("workouts rotate A, B, C", () => {
  assert.equal(nextWorkout([]), "A");
  assert.equal(nextWorkout([{ day: "2026-11-13", workout: "A", finished: true, feel: null, notes: "" }]), "B");
  assert.equal(
    nextWorkout([
      { day: "2026-11-13", workout: "C", finished: true, feel: null, notes: "" },
      { day: "2026-11-15", workout: "A", finished: false, feel: null, notes: "" },
    ]),
    "A",
  );
});

test("the bench forecast needs three days and a rising trend", () => {
  const h = [
    set("2026-11-02", "bench", 1, 60, 5),
    set("2026-11-09", "bench", 1, 62.5, 5),
    set("2026-11-16", "bench", 1, 65, 5),
  ];
  const s = e1rmSeries(h, "bench");
  assert.equal(s.length, 3);
  const p = project(s, 100, "2026-11-16");
  assert.ok(p.ratePerWeek && p.ratePerWeek > 2.5);
  assert.ok(p.eta && p.eta > "2026-11-16");
  assert.equal(project(s.slice(0, 2), 100, "2026-11-16").eta, null);
});

test("a missing trap bar swaps to its alternative", () => {
  // Never a bending alternative for this back: the hip thrust stands in.
  assert.equal(resolve("trap-bar-deadlift", ["trap-bar"])?.key, "hip-thrust");
  assert.equal(resolve("trap-bar-deadlift", [])?.key, "trap-bar-deadlift");
  assert.equal(resolve("mb-chest-pass", ["med-ball"])?.key, "plyo-pushup");
});

test("weeks of three sessions make a streak", () => {
  const s = ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16"].map(
    (day) => ({ day, workout: "A", finished: true, feel: null, notes: "" }),
  );
  assert.deepEqual(consistency(s, [0, 2, 4], "2026-11-16"), { done: 1, planned: 3, streak: 2 });
});
