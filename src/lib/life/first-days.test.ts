import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, plannerRoutine, type LifeProfile } from "./profile.ts";
import {
  assign,
  beforeNextCook,
  freezeCount,
  reminders,
  sizeCooks,
  type Cook,
  type Routine,
  type WeekPlan,
} from "./planner.ts";
import { recipe } from "./recipes.ts";
import { buildState, type LifeRaw } from "./state.ts";
import { suggestWeek } from "./suggest.ts";

// The days before a week's first cook are fed: a week's last cook also makes next
// week's lunches and dinners before next week's first cook, as far as the dish keeps
// in the fridge (FSA), and keeps them cold. A first meal past that still goes to the
// freezer, as before.

// A made-up owner whose meal week starts on Saturday, with one fresh dinner at the
// weekend and the default fresh cooks: Sunday, Monday, Wednesday and Friday at 18:00.
const profile: LifeProfile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1990, heightCm: 175 },
  routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 17 * 60 }], weekendFresh: 1 },
};
const routine = plannerRoutine(profile);
const KCAL = 2900;
const cook = (date: string, recipe: string): Cook => ({
  id: `${date}-${recipe}`,
  recipe,
  date,
  start: 18 * 60,
  portions: 0,
  scale: 1,
});
/** A fresh week from Saturday `start`, its last cook on Friday. */
const freshWeek = (start: string, friday: string): WeekPlan => {
  const day = (n: number) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return {
    start,
    mode: "fresh",
    cooks: [
      cook(day(1), "gnocchi-bake"),
      cook(day(2), "sausage-ragu"),
      cook(day(4), "smoky-mac"),
      cook(day(6), friday),
    ],
    breakfast: "porridge",
    shake: "raspberry-shake",
    fresh: [{ date: start, slot: "dinner", recipe: "steak-chips" }],
    out: [],
    trips: [],
  };
};
const lastOf = (plan: WeekPlan) => plan.cooks[plan.cooks.length - 1];

test("next week's meals before its first cook: Saturday's and Sunday's lunches, not the weekend's fresh dinner", () => {
  assert.deepEqual(beforeNextCook("2026-11-21", "fresh", routine), [
    { date: "2026-11-28", slot: "lunch" },
    { date: "2026-11-29", slot: "lunch" },
  ]);
  // Without the routine's sessions, only next week's first lunch, as before.
  const bare: Routine = { breakfast: 360, lunch: 750, shake: 960, dinner: 1140, maxRepeat: 3, lunchAtWork: true };
  assert.deepEqual(beforeNextCook("2026-11-21", "fresh", bare), [{ date: "2026-11-28", slot: "lunch" }]);
});

test("a Saturday-start fresh week's Friday cook covers next Saturday's and Sunday's lunches while in date", () => {
  // Tuscan chicken keeps two days in the fridge: Friday's dinner, then Saturday's and Sunday's lunches.
  const week = freshWeek("2026-11-21", "tuscan-chicken");
  const sized: WeekPlan = { ...week, cooks: sizeCooks(week, routine, KCAL) };
  const placed = assign(sized, routine, [], KCAL);
  const friday = lastOf(sized);
  assert.equal(friday.portions, 3);
  assert.equal(friday.forNextWeek, 2);
  // Both stay in the fridge: nothing is frozen.
  assert.equal(freezeCount(sized, friday, placed), 0);
  assert.deepEqual(
    reminders(sized, placed).filter((r) => r.kind === "freeze"),
    [],
  );
});

test("a dish that keeps one day covers only next Saturday's lunch", () => {
  // Honey garlic chicken is a rice dish: one day in the fridge, so Sunday's lunch is out of date.
  const week = freshWeek("2026-11-21", "honey-garlic-chicken");
  const sized: WeekPlan = { ...week, cooks: sizeCooks(week, routine, KCAL) };
  const friday = lastOf(sized);
  assert.equal(friday.portions, 2);
  assert.equal(friday.forNextWeek, 1);
  assert.equal(freezeCount(sized, friday, assign(sized, routine, [], KCAL)), 0);
});

test("a batch week keeps next week's first lunch cold when in date, and freezes it when not", () => {
  const batch = (second: number): Routine => ({
    ...plannerRoutine(DEFAULT_PROFILE),
    cooks: [
      { weekday: 6, start: 16 * 60 + 30 },
      { weekday: second, start: 18 * 60 + 30 },
    ],
  });
  const week = (date: string): WeekPlan => ({
    start: "2026-11-15",
    cooks: [
      { ...cook("2026-11-15", "bolognese"), start: 16 * 60 + 30 },
      { ...cook("2026-11-15", "cottage-pie"), start: 16 * 60 + 30 },
      { ...cook(date, "lasagne"), start: 18 * 60 + 30 },
    ],
    breakfast: "porridge",
    shake: "raspberry-shake",
    fresh: [],
    out: [],
  });
  /** The last cook's spare portions, and how many of them go in the freezer. */
  const spareFrozen = (plan: WeekPlan, r: Routine) => {
    const sized: WeekPlan = { ...plan, cooks: sizeCooks(plan, r, KCAL) };
    const placed = assign(sized, r, [], KCAL);
    const last = lastOf(sized);
    const mine = placed.filter((p) => p.cookId === last.id);
    return {
      spareOnes: last.portions - mine.length,
      frozen: freezeCount(sized, last, placed) - mine.filter((p) => p.storage === "freezer").length,
    };
  };
  // Last cook on Friday: next Sunday's lunch is two days on, in date, so it stays cold.
  assert.deepEqual(spareFrozen(week("2026-11-20"), batch(4)), { spareOnes: 1, frozen: 0 });
  // Last cook on Wednesday: four days on, so it goes in the freezer, as before.
  assert.deepEqual(spareFrozen(week("2026-11-18"), batch(2)), { spareOnes: 1, frozen: 1 });
});

test("once Friday's cook is done, next week's Saturday and Sunday lunches come from it", () => {
  const thisWeek = freshWeek("2026-11-21", "tuscan-chicken");
  const nextWeek = freshWeek("2026-11-28", "pesto-chicken");
  const sized = (p: WeekPlan): WeekPlan => ({ ...p, cooks: sizeCooks(p, routine, KCAL) });
  const friday = lastOf(sized(thisWeek));
  const raw: LifeRaw = {
    profile,
    weights: [],
    plans: [thisWeek, nextWeek].map((p) => ({ start: p.start, data: { ...sized(p), createdOn: "2026-11-20" } })),
    // Friday's dinner is eaten from the batch.
    meals: [
      {
        day: "2026-11-27",
        slot: "dinner",
        status: "eaten",
        recipe: friday.recipe,
        batchGid: "fri",
        kcal: 800,
        protein: 50,
        note: null,
      },
    ],
    batches: [
      {
        gid: "fri",
        recipe: friday.recipe,
        cookedOn: "2026-11-27",
        portions: friday.portions,
        remaining: friday.portions - 1,
        scale: friday.scale,
        location: "fridge",
        planStart: "2026-11-21",
        cookId: friday.id,
      },
    ],
    ratings: [],
    lastHad: {},
    stock: [],
    products: [],
    sessions: [],
    sets: [],
  };
  const fromFriday = (ps: { id: string; batchGid?: string; storage?: string }[]) =>
    ps.filter((p) => p.batchGid === "fri" && p.storage === "fridge").map((p) => p.id);
  // On Friday evening, next week's plan already counts on them.
  assert.deepEqual(fromFriday(buildState(raw, "2026-11-27").next.placements), ["2026-11-28:lunch", "2026-11-29:lunch"]);
  // And on Saturday, when that week is this week.
  assert.deepEqual(fromFriday(buildState(raw, "2026-11-28").placements), ["2026-11-28:lunch", "2026-11-29:lunch"]);
});

test("a Saturday-start fresh week's Friday cook is a dish that keeps until next Sunday's lunch", () => {
  const kitchen = { stock: [], products: [], batches: [], kcal: KCAL, routine, rules: profile.food };
  for (const plan of [
    suggestWeek(profile, "2026-11-21", [], {}, {}, "2026-11-20", "fresh"),
    suggestWeek(profile, "2026-11-21", [], {}, {}, "2026-11-20", "fresh", kitchen),
  ]) {
    const friday = plan.cooks.find((c) => c.date === "2026-11-27")!;
    assert.ok(recipe(friday.recipe)!.keeps.fridgeDays >= 2, `'${friday.recipe}'`);
  }
});
