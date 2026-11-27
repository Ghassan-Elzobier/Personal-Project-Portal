import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay } from "./day.ts";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import type { WeekPlan } from "../life/planner.ts";
import { buildState, placedMacros, routineFor, type LifeRaw, type MealLog } from "../life/state.ts";

// Today's kcal for the day counts a meal already logged as what went in the log, so
// a week planned again after breakfast doesn't recount it as the new breakfast.
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
const porridge: MealLog = {
  day: MONDAY,
  slot: "breakfast",
  status: "eaten",
  recipe: "porridge",
  batchGid: null,
  kcal: 613,
  protein: 38,
  note: null,
};

test("Today's kcal for the day counts the breakfast logged, not the plan's new one", () => {
  const kcalOf = (meals: MealLog[]) =>
    Number(/^([\d,]+) of /.exec(yourDay(MONDAY, null, state(meals), 0).summary ?? "")?.[1].replace(",", ""));
  const planned = placedMacros(routineFor(state([]), MONDAY).find((i) => i.slot === "breakfast")!.placement!)!.kcal;
  assert.equal(kcalOf([porridge]), kcalOf([]) - planned + 613);
});
