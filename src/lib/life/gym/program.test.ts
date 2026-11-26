import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISE_MAP, PROGRAM, resolve, type Muscle } from "./program.ts";

// The programme fits the gym and the goals: no kit the gym hasn't room for, a pair
// to start every session, the extras last, and a balanced week of hard sets.

const items = (optional: boolean) =>
  PROGRAM.workouts.flatMap((w) => w.blocks.filter((b) => optional || !b.optional).flatMap((b) => b.items));

test("nothing in the programme needs a box, medicine ball, sled, landmine or kettlebell, and nothing jumps", () => {
  const jumps = ["box-jump", "squat-jump", "broad-jump", "lateral-bound", "plyo-pushup"];
  for (const p of items(true)) {
    const ex = resolve(p.exercise, [])!;
    for (const kit of ["box", "med-ball", "sled", "landmine", "kettlebell"] as const)
      assert.ok(!ex.equipment.includes(kit), `${ex.key} needs a ${kit}`);
    assert.ok(!jumps.includes(ex.key), `${ex.key} jumps`);
    assert.notEqual(ex.load, "ball", `${ex.key} throws a ball`);
  }
});

test("every session starts with a pair, and its extras come after the core", () => {
  for (const w of PROGRAM.workouts) {
    assert.ok(w.blocks[0].superset && w.blocks[0].items.length === 2, `${w.key} starts with a pair`);
    const firstExtra = w.blocks.findIndex((b) => b.optional);
    assert.ok(firstExtra > 0, `${w.key} has extras`);
    assert.ok(
      w.blocks.slice(firstExtra).every((b) => b.optional),
      `${w.key}: no core block after an extra`,
    );
  }
});

test("every exercise in the programme says what it works", () => {
  for (const p of items(true)) assert.ok(EXERCISE_MAP.get(p.exercise)?.muscles, p.exercise);
});

test("a core week gives chest, back, quads, hamstrings and glutes 8 to 13 hard sets each, and nothing more than 15", () => {
  const week = new Map<Muscle, number>();
  for (const p of items(false))
    for (const [m, share] of Object.entries(EXERCISE_MAP.get(p.exercise)!.muscles ?? {}))
      week.set(m as Muscle, (week.get(m as Muscle) ?? 0) + p.sets * share);
  for (const m of ["chest", "back", "quads", "hamstrings", "glutes"] as const) {
    const sets = week.get(m) ?? 0;
    assert.ok(sets >= 8 && sets <= 13, `${m} gets ${sets} sets`);
  }
  for (const [m, sets] of week) assert.ok(sets <= 15, `${m} gets ${sets} sets`);
});

test("every warm-up rolls and every recovery uses the massage gun, with an optional stretch", () => {
  for (const w of PROGRAM.workouts) {
    assert.ok(
      w.warmup.some((s) => /vibrating roller/i.test(s.text)),
      `${w.key} warm-up rolls`,
    );
    assert.ok(
      w.warmup.some((s) => /McGill big three/.test(s.text)),
      `${w.key} warm-up keeps the big three`,
    );
    assert.ok(!w.warmup.some((s) => /massage gun/i.test(s.text)), `${w.key}: no massage gun just before lifting`);
    assert.ok(w.recovery.some((s) => /massage gun/i.test(s.text) && !s.optional));
    assert.ok(w.recovery.some((s) => s.optional));
  }
});
