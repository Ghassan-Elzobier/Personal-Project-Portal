import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { isOtherSize, OTHER_LABEL, OTHER_SIZES, otherMeal } from "./other-meal.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";
import { buildState, effort, routineFor, type LifeRaw, type MealLog } from "./state.ts";

// "I ate something else": the estimate that goes in the log, and what a day logged
// that way counts for. Made-up food and a made-up profile.

const planned = { kcal: 720, protein: 46 };
const share = { kcal: 783, protein: 41 };

test("a meal eaten in place of the planned one is logged as the planned meal, sized by a rough choice", () => {
  assert.deepEqual(otherMeal("about", planned, share), {
    kcal: 720,
    protein: 46,
    note: "Ate something else (about the plan). An estimate.",
  });
  assert.deepEqual(otherMeal("lighter", planned, share), {
    kcal: 432,
    protein: 28,
    note: "Ate something else (lighter). An estimate.",
  });
  assert.deepEqual(otherMeal("bigger", planned, share), {
    kcal: 1008,
    protein: 64,
    note: "Ate something else (bigger). An estimate.",
  });
});

test("a slot with no meal planned uses its share of the day's targets", () => {
  assert.deepEqual(otherMeal("about", null, share), {
    kcal: 783,
    protein: 41,
    note: "Ate something else (about the plan). An estimate.",
  });
  assert.equal(otherMeal("lighter", null, share).kcal, 470);
  // No protein target yet (no weigh-in): the energy is still logged, and the protein is left unknown.
  assert.deepEqual(otherMeal("about", null, { kcal: 783, protein: null }), {
    kcal: 783,
    protein: null,
    note: "Ate something else (about the plan). An estimate.",
  });
});

test("the estimate stays inside what the log can hold", () => {
  assert.equal(otherMeal("bigger", { kcal: 4200, protein: 400 }, share).kcal, 5000);
  assert.equal(otherMeal("bigger", { kcal: 4200, protein: 400 }, share).protein, 500);
  assert.equal(otherMeal("about", { kcal: 0, protein: 0 }, share).kcal, 0);
});

test("there are three sizes, each with a name for the page", () => {
  assert.deepEqual(Object.keys(OTHER_SIZES), ["lighter", "about", "bigger"]);
  assert.deepEqual(Object.values(OTHER_LABEL), ["Lighter", "About the plan", "Bigger"]);
  assert.equal(isOtherSize("about"), true);
  for (const not of ["", "huge", "toString", null, undefined, 1]) assert.equal(isOtherSize(not), false, String(not));
});

// What a day logged this way counts for, through the same state the pages are built from.

const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  routine: { ...DEFAULT_PROFILE.routine, shake: 510 },
};
const week: WeekPlan = {
  start: "2026-11-15",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "b", recipe: "cottage-pie", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
  ],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  createdOn: "2026-11-15",
};
const raw = (plan: WeekPlan, meals: MealLog[]): LifeRaw => ({
  profile,
  weights: [{ day: "2026-11-16", kg: 65 }],
  plans: [{ start: plan.start, data: { ...plan, cooks: sizeCooks(plan, profile.routine as never, 2700) } }],
  meals,
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
});

test("a day whose meals are all logged, one of them eaten out and logged as something else, counts for protein", () => {
  const MONDAY = "2026-11-16";
  // What Monday holds as planned, with dinner marked as eating out.
  const planning = buildState(raw(week, []), "2026-11-17");
  const dinner = planning.placements.find((p) => p.date === MONDAY && p.slot === "dinner");
  assert.ok(dinner, "Monday has a dinner slot");
  const out: WeekPlan = { ...week, out: [dinner.id] };
  const before = buildState(raw(out, []), "2026-11-17");
  const day = before.placements.filter((p) => p.date === MONDAY);
  assert.equal(day.find((p) => p.slot === "dinner")?.source, "out");
  assert.ok(before.targets, "the made-up profile has targets");
  const goal = before.targets.protein;

  // Each planned meal eaten, with a quarter of the day's protein each, and the dinner out logged as something else.
  const quarter = Math.ceil(goal / 4);
  const log = (slot: MealLog["slot"], status: MealLog["status"], protein: number | null): MealLog => ({
    day: MONDAY,
    slot,
    status,
    recipe: null,
    batchGid: null,
    kcal: 700,
    protein,
    note: null,
  });
  const eaten = day.filter((p) => p.slot !== "dinner").map((p) => log(p.slot, "eaten", quarter));
  assert.equal(eaten.length, 3);

  const without = buildState(raw(out, eaten), "2026-11-17");
  assert.equal(effort(without, MONDAY).protein.hit, 0, "three meals of four fall short of the day's protein");

  const withDinner = buildState(raw(out, [...eaten, log("dinner", "swapped", quarter)]), "2026-11-17");
  assert.deepEqual(effort(withDinner, MONDAY).protein, { hit: 1, days: 1 });
  // And the day's routine shows that dinner as done, not as skipped.
  const item = routineFor(withDinner, MONDAY).find((i) => i.slot === "dinner");
  assert.equal(item?.done, true);
  assert.equal(item?.skipped, false);

  // Logged as skipped instead, the same dinner counts for nothing.
  const skipped = buildState(raw(out, [...eaten, log("dinner", "skipped", null)]), "2026-11-17");
  assert.equal(effort(skipped, MONDAY).protein.hit, 0);
});
