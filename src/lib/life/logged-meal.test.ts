import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { recipe } from "./recipes.ts";
import type { WeekPlan } from "./planner.ts";
import { buildState, mealMacros, placedMacros, routineFor, type LifeRaw, type MealLog } from "./state.ts";

// A meal already logged stays what was eaten when the plan changes afterwards: a
// week planned again picks a new breakfast, but this morning's porridge is still
// porridge on Today, on the Meals page and to Claude, with what went in the log.
//
// A made-up owner whose meal week starts on Sunday; today is Monday 16th, and the
// week was planned again after breakfast, with toast and cereal for its mornings.

const profile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const MONDAY = "2026-11-16";
const plan: WeekPlan = {
  start: "2026-11-15",
  cooks: [{ id: "2026-11-16-bolognese", recipe: "bolognese", date: MONDAY, start: 18 * 60, portions: 4, scale: 1 }],
  breakfast: "cereal-toast",
  shake: "vanilla-shake",
  fresh: [],
  out: [],
  createdOn: MONDAY,
};
const log = (
  slot: MealLog["slot"],
  status: MealLog["status"],
  recipeKey: string | null,
  kcal: number,
  protein: number,
) => ({ day: MONDAY, slot, status, recipe: recipeKey, batchGid: null, kcal, protein, note: null }) satisfies MealLog;
const state = (meals: MealLog[]) =>
  buildState(
    {
      profile,
      weights: [],
      plans: [{ start: plan.start, data: plan }],
      meals,
      batches: [],
      ratings: [],
      lastHad: {},
      stock: [],
      products: [],
      sessions: [],
      sets: [],
    } satisfies LifeRaw,
    MONDAY,
  );
const porridge = log("breakfast", "eaten", "porridge", 613, 38);

test("a breakfast eaten before the week was planned again shows the dish eaten and what was logged", () => {
  const breakfast = routineFor(state([porridge]), MONDAY).find((i) => i.slot === "breakfast")!;
  assert.equal(breakfast.done, true);
  assert.equal(breakfast.detail, recipe("porridge")!.name);
  assert.equal(breakfast.href, "/life/recipes/porridge");
  assert.deepEqual(breakfast.macros, { kcal: 613, protein: 38 });
  // The plan itself still has the new breakfast, for the mornings to come.
  assert.equal(breakfast.placement?.recipe, "cereal-toast");
});

test("a meal not logged yet is the plan's; one eaten as something else keeps the plan's name and the estimate logged", () => {
  const items = routineFor(state([log("lunch", "swapped", null, 900, 30)]), MONDAY);
  const breakfast = items.find((i) => i.slot === "breakfast")!;
  assert.equal(breakfast.detail, recipe("cereal-toast")!.name);
  assert.deepEqual(breakfast.macros, placedMacros(breakfast.placement!));
  const lunch = items.find((i) => i.slot === "lunch")!;
  assert.deepEqual(lunch.macros, { kcal: 900, protein: 30 });
  // Skipped counts as planned, as before: Today's figure is the day's plan.
  const dinner = routineFor(state([log("dinner", "skipped", null, 0, 0)]), MONDAY).find((i) => i.slot === "dinner")!;
  assert.deepEqual(dinner.macros, placedMacros(dinner.placement!));
  assert.deepEqual(mealMacros(dinner.placement!, undefined), placedMacros(dinner.placement!));
});
