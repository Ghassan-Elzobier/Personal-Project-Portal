import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { fillGaps, sizeCooks, stillToEat, type Placement, type WeekPlan } from "./planner.ts";
import { buildState, type LifeRaw } from "./state.ts";

// Cooked portions are counted once across the two weeks: next week draws only on
// what this week's meals leave in each batch, and a portion freed by a swapped or
// skipped meal fills an empty lunch or dinner this week, or carries to next week.

const none = (date: string, slot: "lunch" | "dinner"): Placement => ({
  id: `${date}:${slot}`,
  date,
  slot,
  time: slot === "lunch" ? 750 : 1140,
  recipe: null,
  source: "none",
  scale: 1,
});
const batch = (gid: string, cookedOn: string, location: "fridge" | "freezer", left: number) => ({
  gid,
  recipe: "bolognese",
  cookedOn,
  left,
  location,
  scale: 1,
});

test("a spare portion fills the soonest empty lunch or dinner while it is in date, fridge before freezer", () => {
  const gaps = [none("2026-11-16", "lunch"), none("2026-11-16", "dinner"), none("2026-11-25", "lunch")];
  const filled = fillGaps(
    gaps,
    [batch("f", "2026-11-15", "fridge", 1), batch("z", "2026-11-10", "freezer", 1)],
    "2026-11-16",
  );
  assert.deepEqual(
    filled.map((p) => [p.source, p.batchGid ?? null, p.storage ?? null]),
    [
      ["stock", "f", "fridge"],
      ["stock", "z", "freezer"],
      ["none", null, null],
    ],
  );
  assert.equal(filled[1].defrostOn, "2026-11-15");
  // Past its fridge days, a fridge portion fills nothing; days gone aren't filled.
  assert.equal(fillGaps(gaps, [batch("f", "2026-11-01", "fridge", 3)], "2026-11-16")[0].source, "none");
  assert.equal(fillGaps(gaps, [batch("z", "2026-11-10", "freezer", 3)], "2026-11-17")[0].source, "none");
});

test("what this week's meals still take from each batch: placed from it, with nothing logged", () => {
  const from = (date: string, gid: string): Placement => ({ ...none(date, "lunch"), source: "stock", batchGid: gid });
  const taking = stillToEat(
    [from("2026-11-16", "a"), from("2026-11-17", "a"), from("2026-11-18", "b")],
    new Set(["2026-11-16:lunch"]),
  );
  assert.deepEqual(
    [...taking],
    [
      ["a", 1],
      ["b", 1],
    ],
  );
});

// A made-up owner: this week's bolognese is cooked and frozen; next week has no cooks,
// so its meals come only from what the kitchen holds.
const profile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const week: WeekPlan = {
  start: "2026-11-15",
  cooks: [{ id: "a", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 }],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  createdOn: "2026-11-15",
};
const sized = { ...week, cooks: sizeCooks(week, profile.routine as never, 2700) };
const portions = sized.cooks[0].portions;
const raw = (meals: LifeRaw["meals"] = []): LifeRaw => ({
  profile,
  weights: [],
  plans: [
    { start: "2026-11-15", data: sized },
    { start: "2026-11-22", data: { ...week, start: "2026-11-22", cooks: [], createdOn: "2026-11-16" } },
  ],
  meals,
  batches: [
    {
      gid: "a1",
      recipe: "bolognese",
      cookedOn: "2026-11-15",
      portions,
      remaining: portions,
      location: "freezer",
      planStart: "2026-11-15",
      cookId: "a",
      scale: sized.cooks[0].scale,
    } as never,
  ],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
});
const fromBatch = (ps: Placement[]) => ps.filter((p) => p.batchGid === "a1");

test("next week doesn't plan portions this week's meals will eat", () => {
  const s = buildState(raw(), "2026-11-16");
  const thisWeek = fromBatch(s.placements).length;
  assert.ok(thisWeek > 0 && thisWeek <= portions);
  assert.equal(fromBatch(s.next.placements).length, portions - thisWeek);
});

test("a portion freed by a swapped meal is planned again: here, at next week's first gap", () => {
  const first = fromBatch(buildState(raw(), "2026-11-16").placements).find((p) => p.date >= "2026-11-16")!;
  const s = buildState(
    raw([
      {
        day: first.date,
        slot: first.slot,
        status: "swapped",
        recipe: null,
        batchGid: null,
        kcal: 700,
        protein: 40,
        note: null,
      },
    ]),
    "2026-11-16",
  );
  const thisWeek = fromBatch(s.placements).filter((p) => !(p.date === first.date && p.slot === first.slot)).length;
  assert.equal(fromBatch(s.next.placements).length, portions - thisWeek);
  assert.ok(fromBatch(s.next.placements).length >= 1);
});
