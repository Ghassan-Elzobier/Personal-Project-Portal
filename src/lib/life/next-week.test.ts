import { test } from "node:test";
import assert from "node:assert/strict";
import { withNextWeek } from "./cooked.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";
import { buildState, shouldPlanNext, type Batch, type LifeRaw } from "./state.ts";

// Next week plans itself once this week's last planned cook is logged, and only when
// it has no plan: logging any other cook, or a week with nothing to cook, plans nothing.
//
// A made-up owner whose meal week starts on Sunday: this one is Sunday 15th to
// Saturday 21st, with two cooks on Sunday and one on Wednesday. Today is Wednesday 18th.

const profile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const TODAY = "2026-11-18";
const week: WeekPlan = {
  start: "2026-11-15",
  cooks: [
    { id: "2026-11-15-bolognese", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "2026-11-15-cottage-pie", recipe: "cottage-pie", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "2026-11-18-lasagne", recipe: "lasagne", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
  ],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  createdOn: "2026-11-14",
};
const sized = (p: WeekPlan): WeekPlan => ({ ...p, cooks: sizeCooks(p, profile.routine as never, 2700) });
const cooked = (id: string): Batch => ({
  gid: `g-${id}`,
  recipe: id.slice(11),
  cookedOn: id.slice(0, 10),
  portions: 4,
  remaining: 4,
  scale: 1,
  location: "fridge",
  planStart: "2026-11-15",
  cookId: id,
});
const state = (o: { batches?: Batch[]; plans?: WeekPlan[] } = {}) =>
  buildState(
    {
      profile,
      weights: [],
      plans: (o.plans ?? [sized(week)]).map((data) => ({ start: data.start, data })),
      meals: [],
      batches: o.batches ?? [],
      ratings: [],
      lastHad: {},
      stock: [],
      products: [],
      sessions: [],
      sets: [],
    } satisfies LifeRaw,
    TODAY,
  );
const sunday = [cooked("2026-11-15-bolognese"), cooked("2026-11-15-cottage-pie")];

test("logging this week's last cook, with next week unplanned, plans next week", () => {
  assert.equal(shouldPlanNext(state({ batches: sunday }), ["2026-11-18-lasagne"]), true);
  // Logged together, as eating a meal can log its cooks: the same.
  assert.equal(shouldPlanNext(state(), ["2026-11-15-bolognese", "2026-11-15-cottage-pie", "2026-11-18-lasagne"]), true);
});

test("a cook that leaves another still to cook plans nothing", () => {
  assert.equal(shouldPlanNext(state(), ["2026-11-15-bolognese"]), false);
  assert.equal(shouldPlanNext(state({ batches: sunday.slice(0, 1) }), ["2026-11-18-lasagne"]), false);
});

test("a plan next week already has is never replaced", () => {
  const next: WeekPlan = { ...week, start: "2026-11-22", cooks: [], createdOn: TODAY };
  assert.equal(shouldPlanNext(state({ batches: sunday, plans: [sized(week), next] }), ["2026-11-18-lasagne"]), false);
});

test("only a cook of this week counts: none logged, a week with nothing to cook, or one not in the plan", () => {
  const all = [...sunday, cooked("2026-11-18-lasagne")];
  assert.equal(shouldPlanNext(state({ batches: all }), []), false);
  assert.equal(shouldPlanNext(state({ batches: all }), ["2026-11-25-lasagne"]), false);
  const nothingToCook: WeekPlan = { ...week, cooks: [] };
  assert.equal(shouldPlanNext(state({ plans: [nothingToCook] }), []), false);
  assert.equal(shouldPlanNext(state({ plans: [] }), ["2026-11-18-lasagne"]), false);
});

test("the toast after a cook says when next week is planning itself", () => {
  assert.equal(withNextWeek("In the fridge.", {}), "In the fridge.");
  assert.equal(withNextWeek("In the fridge.", { planningNext: false }), "In the fridge.");
  assert.equal(withNextWeek("In the fridge.", undefined), "In the fridge.");
  assert.match(
    withNextWeek("In the fridge.", { planningNext: true }),
    /^In the fridge\. .*next week is planning itself/,
  );
});
