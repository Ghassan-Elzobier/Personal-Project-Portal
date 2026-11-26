import { test } from "node:test";
import assert from "node:assert/strict";
import { blockSeconds, DEFAULT_PACE, estimate, plan, setOrder, setSeconds } from "./duration.ts";
import { PROGRAM, workout, type Block, type Prescription, type Workout } from "./program.ts";

// How long a session takes, from its sets, reps and rests. The numbers below are
// worked out by hand from the default pace: barbell sets 20 s to set up and 4 s a
// rep, dumbbells 10 s and 3.5 s, cables and machines 8 s and 3 s, bodyweight 5 s
// and 3 s, 8 s to log a set, 5 s to change sides, 60 s a ramp-up set and 2 min to
// move between blocks.

const rx = (exercise: string, sets: number, reps: number, rest: number, extra: Partial<Prescription> = {}) =>
  ({ exercise, sets, reps: [reps, reps], rir: 1, rest, scheme: "straight", ...extra }) as Prescription;

test("a set costs its set-up, its reps and the logging, both sides when done on each side, and a timed set its seconds", () => {
  assert.equal(setSeconds(rx("bench", 1, 5, 0)), 20 + 5 * 4 + 8);
  assert.equal(setSeconds({ ...rx("chest-row", 1, 0, 0), reps: [8, 10] }), 10 + 9 * 3.5 + 8);
  assert.equal(setSeconds(rx("pallof", 1, 10, 0)), 8 + 10 * 3 * 2 + 5 + 8);
  assert.equal(setSeconds(rx("bike-sprint", 1, 10, 0, { scheme: "timed" })), 5 + 10 + 8);
  // The middle of a range, rounded up.
  assert.equal(setSeconds({ ...rx("back-squat", 1, 0, 0), reps: [5, 6] }), 20 + 6 * 4 + 8);
});

test("a pair adds up to the hand-worked second, with the partner inside the main lift's rest", () => {
  const block: Block = {
    title: "Made-up pair",
    superset: true,
    items: [rx("bench", 2, 5, 90, { ramp: ["the bar × 10"] }), rx("face-pull", 2, 12, 30)],
  };
  // Bench, face pull, bench, face pull: three rests, none after the last set.
  const sets = 2 * (20 + 5 * 4 + 8) + 2 * (8 + 12 * 3 + 8);
  assert.equal(blockSeconds(block), 120 + 60 + sets + 90 + 30 + 90);
});

test("the sets come in the session page's order, and only the block's very last set has no rest", () => {
  const block: Block = {
    title: "Uneven pair",
    superset: true,
    items: [rx("pull-up", 3, 8, 60), rx("incline-db", 2, 10, 45)],
  };
  assert.deepEqual(setOrder(block), [0, 1, 0, 1, 0]);
  const sets = 3 * (5 + 8 * 3 + 8) + 2 * (10 + 10 * 3.5 + 8);
  assert.equal(blockSeconds(block), 120 + sets + 2 * 60 + 2 * 45);
  // A block that is not a pair finishes one exercise before the next.
  assert.deepEqual(setOrder({ ...block, superset: false }), [0, 0, 0, 1, 1]);
});

test("every core session fits about an hour and every full session 90 minutes, at the default pace", () => {
  for (const w of PROGRAM.workouts) {
    const e = estimate(w);
    assert.ok(e.core >= 55 * 60 && e.core <= 66 * 60, `${w.key} core is ${(e.core / 60).toFixed(1)} min`);
    assert.ok(e.full <= 90 * 60, `${w.key} with everything is ${(e.full / 60).toFixed(1)} min`);
    assert.equal(e.steps, 13 * 60, `${w.key}: 9 minutes of warm-up and 4 of recovery`);
  }
});

test("in every pair each lift comes round every 2 to 3.5 minutes, and the heavy lifts every 3 or so", () => {
  const heavy = ["bench", "paused-bench", "back-squat", "trap-bar-deadlift"];
  for (const w of PROGRAM.workouts)
    for (const b of w.blocks.filter((x) => x.superset && x.items.length === 2)) {
      b.items.forEach((p, i) => {
        const partner = b.items[1 - i];
        const cycle = p.rest + setSeconds(partner) + partner.rest;
        assert.ok(cycle >= 120 && cycle <= 210, `${p.exercise} comes round every ${cycle} s`);
        if (heavy.includes(p.exercise)) assert.ok(cycle >= 170, `${p.exercise} every ${cycle} s`);
      });
    }
});

test("the plan keeps the core, adds extras in order while they fit, and rounds up to 5 minutes", () => {
  const b = workout("B")!;
  const e = estimate(b);
  const extras = b.blocks.map((x) => Boolean(x.optional));
  // Too little time: the core alone, however short the budget.
  const short = plan(b, 40);
  assert.deepEqual(
    short.blocks,
    extras.map((x) => !x),
  );
  assert.equal(short.seconds, e.core);
  assert.equal(short.minutes, Math.ceil(e.core / 300) * 5);
  // Room for the first extra but not the second.
  const some = plan(b, Math.ceil((e.core + e.blocks[3]) / 60));
  assert.deepEqual(some.blocks, [true, true, true, true, false]);
  assert.equal(some.steps, false);
  // Room for everything.
  const all = plan(b, 90);
  assert.ok(all.blocks.every(Boolean) && all.steps);
  assert.equal(all.seconds, e.full);
});

test("a later extra never takes the place of an earlier one that doesn't fit", () => {
  const w: Workout = {
    key: "A",
    name: "Made-up",
    focus: "",
    warmup: [{ text: "Bike", seconds: 300 }],
    recovery: [],
    blocks: [
      { title: "Core", items: [rx("bench", 3, 5, 120)] },
      { title: "Big extra", optional: true, items: [rx("curl", 6, 12, 60)] },
      { title: "Small extra", optional: true, items: [rx("curl", 1, 12, 60)] },
    ],
  };
  const e = estimate(w);
  const p = plan(w, Math.floor((e.core + e.blocks[2]) / 60) + 1);
  assert.deepEqual(p.blocks, [true, false, false]);
});

test("the default pace is the one the programme's numbers were checked with", () => {
  assert.deepEqual(DEFAULT_PACE.rep, { barbell: 4, dumbbell: 3.5, machine: 3, bodyweight: 3 });
  assert.equal(Math.round(estimate(workout("A")!).blocks[0]), 1106);
});
