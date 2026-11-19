import { test } from "node:test";
import assert from "node:assert/strict";
import { target, type SetLog } from "./progress.ts";
import { EXERCISE_MAP, workout } from "./program.ts";

// The reps left in the tank that the lifter logs with each set steer the next
// weight: reps ground out at the limit hold it, reps with plenty to spare take
// two steps. A set logged without it, or as the plan asked, changes nothing.

const item = (w: string, key: string) =>
  workout(w)!
    .blocks.flatMap((b) => b.items)
    .find((p) => p.exercise === key)!;
const step = (key: string) => EXERCISE_MAP.get(key)!.step;

const squat = item("A", "back-squat"); // 3 sets of 5 to 6, 2 in reserve
const row = item("A", "chest-row"); // 3 sets of 8 to 10, 1 in reserve
const bench = item("A", "bench"); // a top set of 4 to 6, then back-offs, 2 in reserve
const pullUp = item("B", "pull-up"); // bodyweight, 4 sets of 6 to 10, 1 in reserve
const legRaise = item("A", "hanging-leg-raise"); // nothing to add

/** One day's sets of an exercise, every one at the same weight and reps, with the reps left given for each. */
const day = (exercise: string, kg: number | null, reps: number, left: (number | null)[]): SetLog[] =>
  left.map((rir, i) => ({ day: "2026-11-13", workout: "A", exercise, position: i + 1, kg, reps, rir }));

test("the programme items these tests lean on are as described", () => {
  assert.deepEqual([squat.sets, squat.reps, squat.rir, squat.scheme], [3, [5, 6], 2, "straight"]);
  assert.deepEqual([row.sets, row.reps, row.rir, row.scheme], [3, [8, 10], 1, "straight"]);
  assert.deepEqual([bench.reps, bench.rir, bench.scheme], [[4, 6], 2, "top-backoff"]);
  assert.deepEqual([pullUp.sets, pullUp.reps, pullUp.rir], [4, [6, 10], 1]);
});

test("the top of the range with nothing left holds the weight", () => {
  const t = target(squat, day("back-squat", 50, 6, [0, 0, 0]), false);
  assert.equal(t.change, "same");
  assert.deepEqual(
    t.sets.map((s) => s.kg),
    [50, 50, 50],
  );
  assert.deepEqual(
    t.sets.map((s) => s.reps),
    [6, 6, 6],
  );
  assert.equal(t.why, "All sets hit 6, but with 0 left: same weight, aim for 6 with 2 in the tank.");
});

test("one set a rep under the plan is enough to hold, because the hardest set decides", () => {
  const t = target(squat, day("back-squat", 50, 6, [2, 2, 1]), false);
  assert.equal(t.change, "same");
  assert.equal(t.sets[0].kg, 50);
  assert.match(t.why, /but with 1 left/);
});

test("every set with two or more to spare takes two steps", () => {
  const t = target(row, day("chest-row", 30, 10, [4, 4, 4]), false);
  assert.equal(t.change, "up");
  assert.equal(t.sets[0].kg, 30 + 2 * step("chest-row"));
  assert.equal(t.sets[0].reps, 8);
  assert.equal(t.why, `All sets hit 10 with 4 or more left: +${2 * step("chest-row")} kg.`);
  // Three left against one asked for is two to spare as well.
  assert.equal(target(row, day("chest-row", 30, 10, [3, 4, 3]), false).sets[0].kg, 30 + 2 * step("chest-row"));
});

test("as planned, a rep to spare, or not logged at all: the single step, as before", () => {
  const single = 30 + step("chest-row");
  for (const left of [
    [1, 1, 1],
    [2, 2, 2],
    [null, null, null],
    [4, 4, null],
    [4, 2, 4],
  ]) {
    const t = target(row, day("chest-row", 30, 10, left), false);
    assert.equal(t.change, "up", String(left));
    assert.equal(t.sets[0].kg, single, String(left));
    assert.equal(t.why, `All sets hit 10: +${step("chest-row")} kg.`, String(left));
  }
});

test("reps left only matter once every set is at the top of the range", () => {
  const short = target(squat, day("back-squat", 50, 5, [0, 0, 0]), false);
  assert.equal(short.change, "same");
  assert.equal(short.why, "Same weight: aim for 6 on every set.");
  const easy = target(row, day("chest-row", 30, 9, [4, 4, 4]), false);
  assert.equal(easy.change, "same");
  assert.equal(easy.sets[0].kg, 30);
});

test("a heavy top set ground out at the limit stays where it is", () => {
  const sets = (left: number | null): SetLog[] => [
    { day: "2026-11-13", workout: "A", exercise: "bench", position: 1, kg: 60, reps: 6, rir: left },
    { day: "2026-11-13", workout: "A", exercise: "bench", position: 2, kg: 52.5, reps: 5, rir: 2 },
  ];
  const held = target(bench, sets(0), false);
  assert.equal(held.change, "same");
  assert.equal(held.sets[0].kg, 60);
  assert.equal(held.why, "You got 6 last time, but with 0 left: same weight, aim for 6 with 2 in the tank.");
  for (const left of [2, 4, null]) {
    const up = target(bench, sets(left), false);
    assert.equal(up.change, "up", String(left));
    assert.equal(up.sets[0].kg, 60 + step("bench"), String(left));
  }
});

test("back from a break, the extra rep in reserve is the plan: logging it changes nothing, and one under holds", () => {
  const asPlanned = target(squat, day("back-squat", 50, 6, [3, 3, 3]), true);
  assert.equal(asPlanned.rir, 3);
  assert.equal(asPlanned.change, "up");
  assert.equal(asPlanned.sets[0].kg, 50 + step("back-squat"));
  const under = target(squat, day("back-squat", 50, 6, [2, 2, 2]), true);
  assert.equal(under.change, "same");
  assert.match(under.why, /aim for 6 with 3 in the tank/);
});

test("a bodyweight move holds the same way, and its first weight on a belt is always the smallest step", () => {
  const held = target(pullUp, day("pull-up", null, 10, [0, 1, 0, 0]), false);
  assert.equal(held.change, "same");
  assert.equal(held.sets[0].kg, null);
  assert.equal(held.why, "All sets hit 10, but with 0 left: same again, aim for 10 with 1 in the tank.");
  const easy = target(pullUp, day("pull-up", null, 10, [4, 4, 4, 4]), false);
  assert.equal(easy.change, "up");
  assert.equal(easy.sets[0].kg, step("pull-up"));
  assert.match(easy.why, /belt/);
  // Once there is weight on the belt it steps like any other lift.
  const loaded = target(pullUp, day("pull-up", 5, 10, [4, 4, 4, 4]), false);
  assert.equal(loaded.sets[0].kg, 5 + 2 * step("pull-up"));
});

test("a move with nothing to add gets harder, not heavier, whatever was left", () => {
  for (const left of [0, 4, null]) {
    const t = target(legRaise, day("hanging-leg-raise", null, 12, [left, left, left]), false);
    assert.equal(t.change, "same", String(left));
    assert.match(t.why, /3 seconds/, String(left));
  }
});
