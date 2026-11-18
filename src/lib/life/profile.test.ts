import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, parseProfile } from "./profile.ts";

test("a profile without a fresh routine gets the default one", () => {
  assert.deepEqual(parseProfile({}).routine.fresh, DEFAULT_PROFILE.routine.fresh);
  assert.deepEqual(
    parseProfile({ routine: { fresh: { cooks: [], trips: "x" } } }).routine.fresh,
    DEFAULT_PROFILE.routine.fresh,
  );
});

test("fresh sessions keep their time limit, rounded, and drop anything that doesn't parse", () => {
  const p = parseProfile({
    routine: {
      fresh: {
        cooks: [
          { weekday: 1, start: 1080, minutes: 47 },
          { weekday: 3, start: 1080, minutes: 5 },
          { weekday: 9, start: 1080, minutes: 45 },
          { weekday: 5, start: "x" },
        ],
        trips: [
          { weekday: 0, start: 600 },
          { weekday: 2, start: 1035, minutes: 30 },
          { weekday: 4, start: 1035 },
          { weekday: 6, start: 600 },
        ],
      },
    },
  });
  assert.deepEqual(p.routine.fresh.cooks, [
    { weekday: 1, start: 1080, minutes: 45 },
    // Too short a limit to mean anything: no limit.
    { weekday: 3, start: 1080 },
    { weekday: 5, start: 1080 },
  ]);
  // At most three shops, and a trip has no time limit.
  assert.deepEqual(p.routine.fresh.trips, [
    { weekday: 0, start: 600 },
    { weekday: 2, start: 1035 },
    { weekday: 4, start: 1035 },
  ]);
});

test("batch cook sessions are unchanged, and at most four", () => {
  const cooks = Array.from({ length: 6 }, (_, i) => ({ weekday: i, start: 990 }));
  assert.equal(parseProfile({ routine: { cooks } }).routine.cooks.length, 4);
  assert.deepEqual(parseProfile({}).routine.cooks, DEFAULT_PROFILE.routine.cooks);
});
