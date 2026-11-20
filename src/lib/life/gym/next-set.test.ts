import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSet, setId, setLabel, type SetBlock } from "./next-set.ts";

// Made-up sessions. A superset alternates its exercises; a straight block finishes
// one before the next.

const superset: SetBlock = {
  superset: true,
  items: [
    { key: "a", sets: 3 },
    { key: "b", sets: 3 },
  ],
};
const straight: SetBlock = {
  superset: false,
  items: [
    { key: "c", sets: 2 },
    { key: "d", sets: 2 },
  ],
};
const done = (...ids: [string, number][]) => new Set(ids.map(([key, position]) => setId(key, position)));

/** Logs whatever comes next until nothing does, and returns the order. */
function walk(blocks: SetBlock[], logged = new Set<string>()): string[] {
  const order: string[] = [];
  for (let next = nextSet(blocks, logged); next; next = nextSet(blocks, logged)) {
    order.push(`${next.key}${next.position}`);
    logged.add(setId(next.key, next.position));
  }
  return order;
}

test("a superset alternates: after A1 comes B1, then A2", () => {
  assert.deepEqual(nextSet([superset], done()), { key: "a", position: 1 });
  assert.deepEqual(nextSet([superset], done(["a", 1])), { key: "b", position: 1 });
  assert.deepEqual(nextSet([superset], done(["a", 1], ["b", 1])), { key: "a", position: 2 });
  assert.deepEqual(walk([superset]), ["a1", "b1", "a2", "b2", "a3", "b3"]);
});

test("when every planned set is logged, nothing is next", () => {
  assert.equal(nextSet([superset], done(["a", 1], ["a", 2], ["a", 3], ["b", 1], ["b", 2], ["b", 3])), null);
  assert.equal(nextSet([], done()), null);
});

test("a straight block finishes one exercise before the next", () => {
  assert.deepEqual(walk([straight]), ["c1", "c2", "d1", "d2"]);
});

test("blocks are done in order: the next block starts only when the one before has nothing left", () => {
  assert.deepEqual(walk([superset, straight]), ["a1", "b1", "a2", "b2", "a3", "b3", "c1", "c2", "d1", "d2"]);
  // A set left behind in an earlier block is still what comes next.
  assert.deepEqual(nextSet([straight, superset], done(["c", 1], ["d", 1], ["d", 2], ["a", 1])), {
    key: "c",
    position: 2,
  });
});

test("a superset with uneven sets ends on the longer exercise", () => {
  const uneven: SetBlock = {
    superset: true,
    items: [
      { key: "a", sets: 4 },
      { key: "b", sets: 2 },
    ],
  };
  assert.deepEqual(walk([uneven]), ["a1", "b1", "a2", "b2", "a3", "a4"]);
});

test("sets logged out of order: the count decides whose turn it is, and the turn takes that exercise's lowest unlogged set", () => {
  // B's second set was ticked first: B has one logged and A none, so A1 is next.
  assert.deepEqual(nextSet([superset], done(["b", 2])), { key: "a", position: 1 });
  // One each: the earlier card goes, with its next set.
  assert.deepEqual(nextSet([superset], done(["b", 2], ["a", 1])), { key: "a", position: 2 });
  // Then B, and the set it skipped.
  assert.deepEqual(nextSet([superset], done(["b", 2], ["a", 1], ["a", 2])), { key: "b", position: 1 });
});

test("a set added beyond the plan doesn't count, and neither does another exercise's", () => {
  assert.deepEqual(nextSet([straight], done(["c", 1], ["c", 2], ["c", 3], ["z", 1])), { key: "d", position: 1 });
  assert.equal(nextSet([straight], done(["c", 1], ["c", 2], ["d", 1], ["d", 2], ["d", 3])), null);
});

test("the line says the exercise, the set, and what it asks for", () => {
  const bench = { name: "Bench press", unit: "reps" as const, added: false, perSide: false };
  assert.equal(setLabel(bench, 2, { kg: 60, reps: 5 }), "Bench press · set 2 · 60 kg × 5");
  assert.equal(setLabel(bench, 1, { kg: null, reps: 5 }), "Bench press · set 1 · 5 reps", "no weight worked out yet");
  const deadBug = { name: "Dead bug", unit: "reps" as const, added: false, perSide: true };
  assert.equal(setLabel(deadBug, 1, { kg: null, reps: 8 }), "Dead bug · set 1 · 8 reps a side");
  const pullUp = { name: "Pull-up", unit: "reps" as const, added: true, perSide: false };
  assert.equal(setLabel(pullUp, 3, { kg: 5, reps: 6 }), "Pull-up · set 3 · +5 kg × 6");
  assert.equal(setLabel(pullUp, 3, { kg: null, reps: 1 }), "Pull-up · set 3 · 1 rep");
  const plank = { name: "Side plank", unit: "s" as const, added: false, perSide: true };
  assert.equal(setLabel(plank, 1, { kg: null, reps: 30 }), "Side plank · set 1 · 30 s a side");
  const carry = { name: "Farmer carry", unit: "m" as const, added: false, perSide: false };
  assert.equal(setLabel(carry, 2, { kg: 24, reps: 20 }), "Farmer carry · set 2 · 24 kg × 20 m");
});
