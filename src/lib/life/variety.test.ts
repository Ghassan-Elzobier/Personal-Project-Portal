import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../dates/week.ts";
import { weekCost, type Kitchen } from "./combo.ts";
import type { Slot } from "./nutrition.ts";
import { assign, sizeCooks, type Placement, type WeekMode, type WeekPlan } from "./planner.ts";
import { DEFAULT_PROFILE, plannerRoutine, type LifeProfile } from "./profile.ts";
import { recipe, RECIPES } from "./recipes.ts";
import { buildState, type LifeRaw, type MealLog } from "./state.ts";
import { rank, suggestWeek } from "./suggest.ts";
import { HALF_LIFE_DAYS, hadBefore, tiredOf, varietyFor, varietyOn, type Had } from "./variety.ts";

// Variety across weeks: what the weeks before had you eat, as satiation that builds
// with each portion and halves every week, and the plans it makes.

// A Sunday: the made-up owner's meal week starts with its first cook.
const ON = "2026-11-22";
const BREAKFAST = RECIPES.find((r) => r.meal === "breakfast")!.key;
const had = (recipeKey: string, ...daysBefore: number[]): Had[] =>
  daysBefore.map((n) => ({ date: addDays(ON, -n), recipe: recipeKey }));

test("each portion adds satiation that halves every week, and only the days before count", () => {
  const v = varietyOn(
    [
      ...had("bolognese", 7),
      // Lunch and dinner the day before: twice as much.
      ...had("lasagne", 1, 1),
      // The day itself and after it are not history yet.
      ...had("cottage-pie", 0, -3),
      // Breakfasts and recipes no longer in the library don't count.
      ...had(BREAKFAST, 2),
      ...had("no-such-recipe", 2),
    ],
    ON,
  );
  assert.ok(Math.abs(v.dish.bolognese - 0.5) < 1e-9, `${v.dish.bolognese}`);
  assert.ok(Math.abs(v.dish.lasagne - 2 * 0.5 ** (1 / HALF_LIFE_DAYS)) < 1e-9, `${v.dish.lasagne}`);
  assert.deepEqual(Object.keys(v.dish).sort(), ["bolognese", "lasagne"]);
  assert.deepEqual(v.last, { bolognese: "2026-11-15", lasagne: "2026-11-21" });
});

test("three portions in the days before cost about 4 points, a week earlier about 1.3, every week for six weeks over 12", () => {
  const r = recipe("bolognese")!;
  const points = (h: Had[]) => tiredOf(varietyOn(h, ON), r);
  assert.equal(points([]), 0);
  const lately = points(had("bolognese", 1, 2, 3));
  assert.ok(lately > 3.5 && lately < 4.5, `${lately}`);
  const weekEarlier = points(had("bolognese", 8, 9, 10));
  assert.ok(weekEarlier > 1 && weekEarlier < 1.6, `${weekEarlier}`);
  const everyWeek = points([0, 1, 2, 3, 4, 5].flatMap((w) => had("bolognese", 7 * w + 1, 7 * w + 2, 7 * w + 3)));
  assert.ok(everyWeek > 12, `${everyWeek}`);
});

const placed = (date: string, slot: Slot, key: string | null): Placement => ({
  id: `${date}:${slot}`,
  date,
  slot,
  time: 0,
  recipe: key,
  source: key ? "cook" : "none",
  scale: 1,
});
const logged = (day: string, slot: Slot, status: MealLog["status"], key: string | null): MealLog => ({
  day,
  slot,
  status,
  recipe: key,
  batchGid: null,
  kcal: null,
  protein: null,
  note: null,
});
const byDay = (a: Had, b: Had) => a.date.localeCompare(b.date) || a.recipe.localeCompare(b.recipe);

test("what was had is each week as placed, unless logged: eaten as logged, nothing for a skip or a swap", () => {
  const weeks = [
    [
      placed("2026-11-16", "breakfast", BREAKFAST),
      placed("2026-11-16", "lunch", "bolognese"),
      placed("2026-11-16", "dinner", "lasagne"),
      placed("2026-11-17", "lunch", "cottage-pie"),
      placed("2026-11-17", "dinner", null),
      placed("2026-11-22", "lunch", "beef-chilli"),
    ],
  ];
  const meals = [
    // Ticked as eaten: the recipe it was placed with.
    logged("2026-11-16", "lunch", "eaten", null),
    logged("2026-11-16", "dinner", "skipped", "lasagne"),
    logged("2026-11-17", "lunch", "swapped", null),
    // A meal no week placed, logged as eaten.
    logged("2026-11-18", "dinner", "eaten", "tuscan-chicken"),
    logged("2026-11-23", "dinner", "eaten", "smoky-mac"),
  ];
  assert.deepEqual(hadBefore(weeks, meals, ON).sort(byDay), [
    { date: "2026-11-16", recipe: "bolognese" },
    { date: "2026-11-18", recipe: "tuscan-chicken" },
  ]);
});

// A made-up owner, set up, with the default routine: cooks on Sunday and Wednesday.
const profile: LifeProfile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const KCAL = 2900;
const routine = plannerRoutine(profile);

/** A batch week: two mains on Sunday, two on Wednesday. */
function batchWeek(start: string, mains: [string, string, string, string]): WeekPlan {
  const wednesday = addDays(start, 3);
  const cook = (key: string, date: string, at: number) => ({
    id: `${date}-${key}`,
    recipe: key,
    date,
    start: at,
    portions: 0,
    scale: 1,
  });
  const plan: WeekPlan = {
    start,
    cooks: [
      cook(mains[0], start, 990),
      cook(mains[1], start, 990),
      cook(mains[2], wednesday, 1110),
      cook(mains[3], wednesday, 1110),
    ],
    breakfast: BREAKFAST,
    shake: "",
    fresh: [],
    out: [],
    createdOn: addDays(start, -1),
  };
  return { ...plan, cooks: sizeCooks(plan, routine, KCAL) };
}

test("next week, planned midweek, knows what this week is still to eat; this week's re-plan only what was logged", () => {
  const last = "2026-11-15";
  const next = addDays(ON, 7);
  const today = addDays(ON, 3);
  const raw: LifeRaw = {
    profile,
    weights: [{ day: last, kg: 70 }],
    plans: [
      { start: last, data: batchWeek(last, ["bolognese", "lasagne", "cottage-pie", "smoky-mac"]) },
      { start: ON, data: batchWeek(ON, ["tuscan-chicken", "chicken-leek-pie", "sausage-ragu", "beef-chilli"]) },
    ],
    meals: [logged(addDays(ON, 1), "lunch", "eaten", "tuscan-chicken")],
    batches: [],
    ratings: [],
    lastHad: {},
    stock: [],
    products: [],
    sessions: [],
    sets: [],
  };
  const s = buildState(raw, today);
  assert.equal(s.weekStart, ON);

  const forNext = varietyFor(s, next);
  // Wednesday's dishes are eaten from Wednesday evening to Saturday, after today.
  for (const key of ["sausage-ragu", "beef-chilli"]) assert.ok((forNext.last[key] ?? "") > today, key);
  for (const key of ["tuscan-chicken", "chicken-leek-pie", "bolognese", "lasagne"])
    assert.ok((forNext.dish[key] ?? 0) > 0, key);
  // This week's dishes weigh more than last week's.
  assert.ok(forNext.dish["tuscan-chicken"] > forNext.dish.bolognese);

  // Planned again from today, this week's own plan is what is being replaced: only the meal logged counts.
  const forThis = varietyFor(s, ON);
  assert.ok((forThis.dish["tuscan-chicken"] ?? 0) > 0);
  for (const key of ["chicken-leek-pie", "sausage-ragu", "beef-chilli"])
    assert.equal(forThis.dish[key], undefined, key);
  assert.ok((forThis.dish.bolognese ?? 0) > 0);
});

test("with variety, a main had lately ranks lower, other meals rank as before, and a month means a month of both", () => {
  const ratings = [{ recipe: "bolognese", stars: 5 }];
  const plain = rank(profile, "main", ratings, { bolognese: addDays(ON, -40) }, {}, ON);
  const lately = varietyOn(had("bolognese", 10, 11), ON);
  const tired = rank(profile, "main", ratings, { bolognese: addDays(ON, -40) }, {}, ON, lately);
  const before = plain.find((r) => r.recipe.key === "bolognese")!;
  const after = tired.find((r) => r.recipe.key === "bolognese")!;
  assert.ok(before.reasons.includes("Not had it in a month"));
  assert.ok(!after.reasons.includes("Not had it in a month"), "it was planned ten days ago");
  assert.ok(after.score < before.score - 1, `${after.score} against ${before.score}`);
  // Nothing had lately: the same score as with no variety at all.
  const fresh = varietyOn([], ON);
  assert.deepEqual(
    rank(profile, "main", [], {}, {}, ON, fresh).map((r) => [r.recipe.key, r.score]),
    rank(profile, "main", [], {}, {}, ON).map((r) => [r.recipe.key, r.score]),
  );
  assert.deepEqual(rank(profile, "breakfast", [], {}, {}, ON, lately), rank(profile, "breakfast", [], {}, {}, ON));
});

/** Eight weeks planned one after another with nothing logged: the mains of each, and what each costs. */
function eightWeeks(p: LifeProfile, mode: WeekMode, memory: boolean): { mains: string[][]; pence: number } {
  const kitchen: Kitchen = {
    stock: [],
    products: [],
    batches: [],
    kcal: KCAL,
    routine: plannerRoutine(p),
    rules: p.food,
  };
  const weeks: Placement[][] = [];
  const mains: string[][] = [];
  let pence = 0;
  for (let w = 0, start = ON; w < 8; w++, start = addDays(start, 7)) {
    const variety = memory ? varietyOn(hadBefore(weeks, [], start), start) : undefined;
    const plan = suggestWeek(p, start, [], {}, {}, start, mode, kitchen, variety);
    const sized = { ...plan, cooks: sizeCooks(plan, kitchen.routine, KCAL) };
    weeks.push(assign(sized, kitchen.routine, [], KCAL));
    mains.push(sized.cooks.filter((c) => recipe(c.recipe)?.meal === "main").map((c) => c.recipe));
    const cost = weekCost(sized, kitchen);
    pence += cost.pence + cost.waste;
  }
  return { mains, pence };
}
const fromWeekBefore = (mains: string[][]) => mains.slice(1).flatMap((m, i) => m.filter((k) => mains[i].includes(k)));

test("planned week after week with nothing logged, the mains take turns, at about the same cost", () => {
  // The made-up owner's batch weeks, and a made-up owner with every kind of kit for fresh weeks.
  const kitted: LifeProfile = { ...profile, kit: ["oven", "hob", "air fryer", "blender"], spiceMax: 3 };
  for (const [p, mode] of [
    [profile, "batch"],
    [kitted, "fresh"],
  ] as const) {
    const same = eightWeeks(p, mode, false);
    const turns = eightWeeks(p, mode, true);
    assert.equal(new Set(same.mains.flat()).size, 4, `${mode}: without a memory, the same four every week`);
    assert.ok(new Set(turns.mains.flat()).size >= 10, `${mode}: ${turns.mains.join(" | ")}`);
    const repeats = fromWeekBefore(turns.mains);
    assert.ok(repeats.length <= 4, `${mode}: ${repeats.length} of 28 repeat the week before (${repeats.join(", ")})`);
    assert.ok(turns.pence <= same.pence * 1.05, `${mode}: ${turns.pence} against ${same.pence}`);
  }
});
