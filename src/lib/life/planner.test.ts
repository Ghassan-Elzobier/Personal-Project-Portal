import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, mealWeekStart, reminders, sizeCooks, spare, type Routine, type WeekPlan } from "./planner.ts";
import { recipe } from "./recipes.ts";
import { catchUp, suggestWeek } from "./suggest.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import type { Kit } from "./recipes.ts";

const routine: Routine = { breakfast: 360, lunch: 750, shake: 960, dinner: 1140, maxRepeat: 3, lunchAtWork: true };
// Sunday 15 Nov 2026 starts the meal week. Cook on Sunday and Wednesday.
const base: WeekPlan = {
  start: "2026-11-15",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "b", recipe: "butter-chicken", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "c", recipe: "cottage-pie", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
    { id: "d", recipe: "shawarma-bowls", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
    { id: "e", recipe: "blueberry-muffins", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
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

test("a breakfast batch covers the mornings after it is made, frozen past its fridge days", () => {
  const plan = { ...base, cooks: sizeCooks(base, routine, 2900) };
  const placed = assign(plan, routine, [], 2900).filter((p) => p.slot === "breakfast");
  // Sunday breakfast comes before the Sunday cook, so it is the quick one.
  assert.equal(placed[0].recipe, "bagel-ham");
  assert.ok(placed.slice(1).every((p) => p.recipe === "blueberry-muffins"));
  assert.deepEqual(placed.slice(1).map((p) => p.storage), ["fridge", "fridge", "fridge", "freezer", "freezer", "freezer"]);
});

test("on gym days the shake comes straight after training, and shakes take turns", () => {
  const r: Routine = { ...routine, gymDays: [0, 2, 4], gymEnd: 480 };
  const plan = { ...base, shakes: ["raspberry-shake", "vanilla-shake", "chocolate-shake"], cooks: sizeCooks(base, r, 2900) };
  const shakes = assign(plan, r, [], 2900).filter((p) => p.slot === "shake");
  // Monday 16 Nov is a gym day, Sunday 15 is not.
  assert.equal(shakes.find((p) => p.date === "2026-11-16")?.time, 490);
  assert.equal(shakes.find((p) => p.date === "2026-11-15")?.time, routine.shake);
  assert.deepEqual(shakes.slice(0, 4).map((p) => p.recipe), ["raspberry-shake", "vanilla-shake", "chocolate-shake", "raspberry-shake"]);
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

test("a week planned with two days left cooks one main and no breakfast batch", () => {
  // Saturday-to-Friday week, cooks Saturday and Wednesday, planned on Thursday.
  const profile = { ...DEFAULT_PROFILE, routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 1020 }, { weekday: 2, start: 1110 }] } };
  const late = suggestWeek(profile, "2026-11-07", [], {}, {}, "2026-11-12");
  assert.equal(late.cooks.length, 1);
  assert.equal(recipe(late.cooks[0].recipe)?.meal, "main");
  assert.equal(late.cooks[0].date, "2026-11-12");
  assert.ok(recipe(late.breakfast)?.daily, "the daily breakfast covers the mornings left");
  // Planned on time, the same week has two mains a session and a breakfast batch.
  const onTime = suggestWeek(profile, "2026-11-07", [], {}, {}, "2026-11-06");
  assert.equal(onTime.cooks.filter((c) => recipe(c.recipe)?.meal === "main").length, 4);
  assert.equal(onTime.cooks.filter((c) => recipe(c.recipe)?.meal === "breakfast").length, 1);
});

test("a suggested week rotates three shakes, skips hidden recipes and cooks one weekend dinner fresh", () => {
  const profile = { ...DEFAULT_PROFILE, kit: ["oven", "hob", "air fryer", "blender"] as Kit[], hidden: ["bolognese", "protein-pancakes", "blueberry-muffins"], routine: { ...DEFAULT_PROFILE.routine, weekendFresh: 1 } };
  const plan = suggestWeek(profile, "2026-11-15", [], {}, {}, "2026-11-14");
  assert.equal(plan.shakes?.length, 3);
  assert.ok(!plan.cooks.some((c) => profile.hidden.includes(c.recipe)));
  assert.equal(plan.fresh.length, 1);
  // Sunday 15 is a cook day, so the fresh dinner is Saturday 21.
  assert.equal(plan.fresh[0].date, "2026-11-21");
  assert.ok(recipe(plan.fresh[0].recipe)?.tags.includes("weekend"));
});
