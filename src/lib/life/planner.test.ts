import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, mealWeekStart, reminders, sizeCooks, spare, type Routine, type WeekPlan } from "./planner.ts";
import { recipe } from "./recipes.ts";
import { catchUp, suggestWeek } from "./suggest.ts";
import { DEFAULT_PROFILE } from "./profile.ts";

const routine: Routine = { breakfast: 360, lunch: 750, shake: 960, dinner: 1140, maxRepeat: 3, lunchAtWork: true };
// Sunday 15 Nov 2026 starts the meal week. Cook on Sunday and Wednesday.
const base: WeekPlan = {
  start: "2026-11-15",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "b", recipe: "butter-chicken", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "c", recipe: "cottage-pie", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
    { id: "d", recipe: "shawarma-bowls", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
    { id: "e", recipe: "overnight-oats", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
  ],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
};

test("a meal week starts on its weekday", () => {
  assert.equal(mealWeekStart("2026-11-18", 6), "2026-11-15");
  assert.equal(mealWeekStart("2026-11-15", 6), "2026-11-15");
});

test("cooks are sized to cover every lunch and dinner after them", () => {
  const cooks = sizeCooks(base, routine, 2900);
  const plan = { ...base, cooks };
  const placed = assign(plan, routine, [], 2900);
  const mains = placed.filter((p) => p.slot === "lunch" || p.slot === "dinner");
  // Only the first Sunday lunch, before any cooking, has nothing.
  assert.deepEqual(mains.filter((p) => p.source === "none").map((p) => p.id), ["2026-11-15:lunch"]);
  assert.ok(cooks.every((c) => c.scale >= 0.75 && c.scale <= 1.5));
  // One portion is left for next Sunday's lunch.
  assert.equal(spare(plan, placed).reduce((n, s) => n + s.portions, 0), 1);
});

test("never more than three days running of one dish in a slot, and lunch differs from dinner", () => {
  const plan = { ...base, cooks: sizeCooks(base, routine, 2900) };
  const placed = assign(plan, routine, [], 2900);
  for (const slot of ["lunch", "dinner"]) {
    const seq = placed.filter((p) => p.slot === slot).map((p) => p.recipe);
    for (let i = 3; i < seq.length; i++) assert.ok(!(seq[i] && seq[i] === seq[i - 1] && seq[i] === seq[i - 2] && seq[i] === seq[i - 3]), `${slot} repeats 4 days`);
  }
  for (const p of placed.filter((x) => x.slot === "dinner" && x.recipe)) {
    const lunch = placed.find((x) => x.date === p.date && x.slot === "lunch");
    assert.notEqual(lunch?.recipe, p.recipe, p.date);
  }
});

test("food eaten past its fridge days is frozen and defrosted the evening before", () => {
  const plan = { ...base, cooks: sizeCooks(base, routine, 2900) };
  const placed = assign(plan, routine, [], 2900);
  for (const p of placed.filter((x) => x.source === "cook")) {
    const age = (Date.parse(p.date) - Date.parse(p.cookedOn!)) / 86_400_000;
    if (age > recipe(p.recipe!)!.keeps.fridgeDays) {
      assert.equal(p.storage, "freezer", `${p.id} ${p.recipe}`);
      assert.ok(p.defrostOn);
    } else assert.equal(p.storage, "fridge", p.id);
  }
  const notes = reminders(plan, placed);
  assert.ok(notes.some((r) => r.kind === "defrost"));
  assert.ok(notes.some((r) => r.kind === "freeze"));
});

test("breakfast batches run out after their fridge days, then the daily breakfast fills in", () => {
  const plan = { ...base, cooks: sizeCooks(base, routine, 2900) };
  const placed = assign(plan, routine, [], 2900).filter((p) => p.slot === "breakfast");
  assert.equal(placed[0].recipe, "bagel-ham");
  assert.deepEqual(placed.slice(1, 4).map((p) => p.recipe), ["overnight-oats", "overnight-oats", "overnight-oats"]);
  assert.equal(placed[4].recipe, "bagel-ham");
});

test("stock in the freezer feeds the gap before the first cook", () => {
  const placed = assign({ ...base, cooks: sizeCooks(base, routine, 2900) }, routine, [{ gid: "9", recipe: "lasagne", cookedOn: "2026-11-11", left: 2, location: "freezer", scale: 1 }], 2900);
  const first = placed.find((p) => p.id === "2026-11-15:lunch")!;
  assert.equal(first.recipe, "lasagne");
  assert.equal(first.source, "stock");
});

test("meals out and fresh meals are kept", () => {
  const plan: WeekPlan = { ...base, out: ["2026-11-20:dinner"], fresh: [{ date: "2026-11-21", slot: "dinner", recipe: "steak-chips" }] };
  const placed = assign({ ...plan, cooks: sizeCooks(plan, routine, 2900) }, routine, [], 2900);
  assert.equal(placed.find((p) => p.id === "2026-11-20:dinner")?.source, "out");
  assert.equal(placed.find((p) => p.id === "2026-11-21:dinner")?.recipe, "steak-chips");
});

test("planning late moves the cook sessions already gone to one today", () => {
  const sessions = [
    { date: "2026-11-08", start: 990 },
    { date: "2026-11-11", start: 1110 },
  ];
  assert.deepEqual(catchUp(sessions, "2026-11-12"), [{ date: "2026-11-12", start: 1110 }]);
  assert.deepEqual(catchUp(sessions, "2026-11-10"), [{ date: "2026-11-10", start: 990 }, { date: "2026-11-11", start: 1110 }]);
  assert.deepEqual(catchUp(sessions, "2026-11-08"), sessions);
  const plan = suggestWeek(DEFAULT_PROFILE, "2026-11-08", [], {}, {}, "2026-11-12");
  assert.ok(plan.cooks.every((c) => c.date >= "2026-11-12"));
});
