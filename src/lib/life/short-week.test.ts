import { test } from "node:test";
import assert from "node:assert/strict";
import { weekCost, type Kitchen } from "./combo.ts";
import { DEFAULT_PROFILE, plannerRoutine, type LifeProfile } from "./profile.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";
import { recipe } from "./recipes.ts";
import { buildState, remainingNeeds, tripLists, weekView, type Batch, type LifeRaw } from "./state.ts";
import { daysLeft, dinnersLeft, isShortWeek, suggestPlan, suggestWeek } from "./suggest.ts";

// A week planned with two days or fewer left gets just those days, as lean as it can:
// each dinner cooked fresh, lunches from the kitchen or nothing, the daily breakfast
// and shakes, no cook, and one shop today before dinner. Any other week is planned
// as before.
//
// A made-up owner whose meal week runs Saturday to Friday: this one is Saturday 14th
// to Friday 20th. The routine shops on Sunday at 10:00 and Wednesday at 17:15, cooks
// a fresh week's dish in 45 minutes, and eats dinner at 19:00.

const profile: LifeProfile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1990, heightCm: 175 },
  routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 17 * 60 }] },
};
const START = "2026-11-14";
const FRIDAY = "2026-11-20";
const THURSDAY = "2026-11-19";
const MORNING = 9 * 60 + 30;

const plan = (today: string, now = MORNING, p = profile) =>
  suggestPlan(p, START, [], {}, {}, today, "batch", undefined, now);

test("two days or fewer left is a short week; three or more, or a week not started, is not", () => {
  assert.equal(daysLeft(START, FRIDAY), 1);
  assert.equal(daysLeft(START, THURSDAY), 2);
  assert.equal(daysLeft(START, "2026-11-18"), 3);
  assert.equal(daysLeft(START, "2026-11-13"), 7);
  assert.equal(daysLeft(START, "2026-11-21"), 0);
  assert.deepEqual(
    ["2026-11-13", START, "2026-11-18", THURSDAY, FRIDAY, "2026-11-21"].map((d) => isShortWeek(START, d)),
    [false, false, false, true, true, false],
  );
});

test("planned on its last day, the week cooks tonight's dinner fresh, cooks nothing and shops once today", () => {
  const p = plan(FRIDAY);
  assert.equal(p.short, true);
  assert.equal(p.mode, "fresh");
  assert.deepEqual(p.cooks, []);
  assert.deepEqual(
    p.fresh.map((f) => [f.date, f.slot]),
    [[FRIDAY, "dinner"]],
  );
  const dinner = recipe(p.fresh[0].recipe)!;
  assert.equal(dinner.meal, "main");
  // Friday is a weeknight: a quick dish, within the routine's short cook.
  assert.ok(dinner.totalMin <= 45, `${dinner.key} takes ${dinner.totalMin} minutes`);
  assert.ok(!dinner.tags.includes("weekend"), dinner.key);
  // No shop on Fridays in the routine: one a little before dinner.
  assert.deepEqual(
    p.trips?.map((t) => [t.date, t.start]),
    [[FRIDAY, 18 * 60]],
  );
  assert.ok(recipe(p.breakfast)?.daily, "the daily breakfast");
  // Breakfasts and shakes as a fresh week has them (shakes take a blender).
  const blender: LifeProfile = { ...profile, kit: [...profile.kit, "blender"] };
  const usual = suggestWeek(blender, START, [], {}, {}, FRIDAY, "fresh");
  const short = plan(FRIDAY, MORNING, blender);
  assert.ok(short.shakes?.length, "shakes");
  assert.deepEqual([short.breakfast, short.shake, short.shakes], [usual.breakfast, usual.shake, usual.shakes]);
});

test("the shop goes at the routine's time that day while it is still to come and before dinner", () => {
  const shopsFriday: LifeProfile = {
    ...profile,
    routine: {
      ...profile.routine,
      fresh: { ...profile.routine.fresh, trips: [...profile.routine.fresh.trips, { weekday: 4, start: 17 * 60 + 15 }] },
    },
  };
  assert.equal(plan(FRIDAY, MORNING, shopsFriday).trips?.[0].start, 17 * 60 + 15);
  // Past it: a little before dinner. Past that too, now.
  assert.equal(plan(FRIDAY, 17 * 60 + 30, shopsFriday).trips?.[0].start, 18 * 60);
  assert.equal(plan(FRIDAY, 18 * 60 + 22, shopsFriday).trips?.[0].start, 18 * 60 + 25);
});

test("planned on its second-to-last day, each night gets its own fresh dinner and one shop today buys both", () => {
  const p = plan(THURSDAY);
  assert.deepEqual(p.cooks, []);
  assert.deepEqual(
    p.fresh.map((f) => f.date),
    [THURSDAY, FRIDAY],
  );
  assert.equal(new Set(p.fresh.map((f) => f.recipe)).size, 2, "two different dishes");
  assert.deepEqual(
    p.trips?.map((t) => t.date),
    [THURSDAY],
  );
});

test("late in the evening, today's dinner is gone: the last day has nothing left, the day before plans tomorrow's", () => {
  const late = 21 * 60 + 30;
  assert.deepEqual(dinnersLeft(profile, START, FRIDAY, late), []);
  const over = plan(FRIDAY, late);
  assert.deepEqual([over.fresh, over.trips], [[], []]);
  const thursday = plan(THURSDAY, late);
  assert.deepEqual(
    thursday.fresh.map((f) => f.date),
    [FRIDAY],
  );
  // The shop is on the day of the dinner, at the usual time before it.
  assert.deepEqual(
    thursday.trips?.map((t) => [t.date, t.start]),
    [[FRIDAY, 18 * 60]],
  );
});

test("a week with three days or more left, or planned ahead, is planned as before", () => {
  for (const today of ["2026-11-18", START, "2026-11-13"])
    for (const mode of ["batch", "fresh"] as const)
      assert.deepEqual(
        suggestPlan(profile, START, [], {}, {}, today, mode, undefined, MORNING),
        suggestWeek(profile, START, [], {}, {}, today, mode),
        `${mode} on ${today}`,
      );
  assert.ok(plan("2026-11-18").cooks.length > 0, "still a catch-up cook today");
});

// ------------------------------------------------------------------ in the kitchen

const sized = (p: WeekPlan, today: string): WeekPlan => ({
  ...p,
  cooks: sizeCooks(p, plannerRoutine(profile), 2900),
  createdOn: today,
});
const raw = (p: WeekPlan, batches: Batch[] = []): LifeRaw => ({
  profile,
  weights: [],
  plans: [{ start: START, data: p }],
  meals: [],
  batches,
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
});
const buying = (r: LifeRaw, today: string) =>
  tripLists(buildState(r, today), weekView(buildState(r, today), "this"))
    .open.flatMap((t) => t.lines)
    .filter((l) => l.packs > 0);

test("the shop buys a lot less than the old catch-up cook did, and nothing for days gone", () => {
  const lean = sized(plan(FRIDAY), FRIDAY);
  // The week as it was planned before: a catch-up cook today and a shop for the rest.
  const old = sized(suggestWeek(profile, START, [], {}, {}, FRIDAY, "fresh"), FRIDAY);
  assert.equal(old.cooks.length, 1);
  const leanList = buying(raw(lean), FRIDAY);
  const oldList = buying(raw(old), FRIDAY);
  assert.ok(leanList.length > 0, "tonight's dinner is bought");
  assert.ok(
    leanList.reduce((t, l) => t + l.pence, 0) < oldList.reduce((t, l) => t + l.pence, 0),
    `${leanList.map((l) => l.item.key).join(", ")} against ${oldList.map((l) => l.item.key).join(", ")}`,
  );
  const s = buildState(raw(lean), FRIDAY);
  for (const n of remainingNeeds(s)) assert.ok(n.firstUse >= FRIDAY, `${n.item} for ${n.firstUse}`);
});

test("what the week costs counts only the days from when it was planned", () => {
  const kitchen: Kitchen = {
    stock: [],
    products: [],
    batches: [],
    kcal: 2900,
    routine: plannerRoutine(profile),
    rules: profile.food,
  };
  const lean = sized(plan(FRIDAY), FRIDAY);
  const now = weekCost(lean, kitchen);
  const wholeWeek = weekCost({ ...lean, createdOn: undefined }, kitchen);
  assert.equal(now.trips, 1);
  assert.ok(now.pence < wholeWeek.pence, `${now.pence} against ${wholeWeek.pence}`);
  assert.ok(now.kcal < wholeWeek.kcal / 3, "about one day's food");
});

test("lunches come from cooked portions in the kitchen, kept for the days left, and are nothing planned without", () => {
  const lean = sized(plan(THURSDAY), THURSDAY);
  const lunches = (batches: Batch[]) =>
    buildState(raw(lean, batches), THURSDAY)
      .placements.filter((p) => p.slot === "lunch" && p.date >= THURSDAY)
      .map((p) => p.source);
  assert.deepEqual(lunches([]), ["none", "none"]);
  // Two portions of a dish cooked on Wednesday, in the fridge: not placed on the days gone.
  const leftovers: Batch = {
    gid: "b1",
    recipe: "bolognese",
    cookedOn: "2026-11-18",
    portions: 4,
    remaining: 2,
    scale: 1,
    location: "fridge",
    planStart: null,
    cookId: null,
  };
  assert.deepEqual(lunches([leftovers]), ["stock", "stock"]);
  // The dinners stay fresh.
  assert.deepEqual(
    buildState(raw(lean, [leftovers]), THURSDAY)
      .placements.filter((p) => p.slot === "dinner" && p.date >= THURSDAY)
      .map((p) => p.source),
    ["fresh", "fresh"],
  );
});
