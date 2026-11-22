import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";
import { buildState, cookBatches, cookedIds, plannedCook, routineFor, type Batch, type LifeRaw } from "./state.ts";

// One answer to "is this cook done?": a cook is done once a batch was logged from it.
// Every page, Today, Claude's tools and the saves ask `cookBatches` / `cookedIds`.

const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
};
const week = (start: string): WeekPlan => {
  const plan: WeekPlan = {
    start,
    cooks: [
      { id: `${start}-bolognese`, recipe: "bolognese", date: start, start: 990, portions: 0, scale: 1 },
      { id: `${start}-cottage-pie`, recipe: "cottage-pie", date: start, start: 990, portions: 0, scale: 1 },
    ],
    breakfast: "bagel-ham",
    shake: "raspberry-shake",
    fresh: [],
    out: [],
    createdOn: "2026-11-14",
  };
  return { ...plan, cooks: sizeCooks(plan, profile.routine as never, 2700) };
};
const batch = (gid: string, over: Partial<Batch>): Batch => ({
  gid,
  recipe: "bolognese",
  cookedOn: "2026-11-15",
  portions: 2,
  remaining: 2,
  scale: 1,
  location: "fridge",
  planStart: null,
  cookId: null,
  ...over,
});
const batches: Batch[] = [
  // This week's bolognese, split into a fridge and a freezer batch.
  batch("a", { planStart: "2026-11-15", cookId: "2026-11-15-bolognese" }),
  batch("b", { planStart: "2026-11-15", cookId: "2026-11-15-bolognese", location: "freezer" }),
  // Next week's cottage pie, cooked early.
  batch("c", { recipe: "cottage-pie", planStart: "2026-11-22", cookId: "2026-11-22-cottage-pie" }),
  // A batch from this week with no cook behind it, and one off-plan.
  batch("d", { planStart: "2026-11-15" }),
  batch("e", {}),
];
const raw: LifeRaw = {
  profile,
  weights: [{ day: "2026-11-16", kg: 65 }],
  plans: [
    { start: "2026-11-15", data: week("2026-11-15") },
    { start: "2026-11-22", data: week("2026-11-22") },
  ],
  meals: [],
  batches,
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
};
const s = buildState(raw, "2026-11-16");

test("a cook split into fridge and freezer batches is one cook done, with both batches", () => {
  assert.deepEqual(
    cookBatches(s, "2026-11-15", "2026-11-15-bolognese").map((b) => b.gid),
    ["a", "b"],
  );
  assert.deepEqual([...cookedIds(s, "2026-11-15")], ["2026-11-15-bolognese"]);
});

test("a cook belongs to its own week, and a batch with no cook counts for none", () => {
  assert.deepEqual([...cookedIds(s, "2026-11-22")], ["2026-11-22-cottage-pie"]);
  assert.deepEqual(cookBatches(s, "2026-11-22", "2026-11-15-bolognese"), []);
  assert.deepEqual(
    cookBatches(s, "2026-11-15").map((b) => b.gid),
    ["a", "b"],
  );
});

test("no week has no cooks", () => {
  assert.equal(cookedIds(s, null).size, 0);
  assert.equal(cookedIds(s, undefined).size, 0);
  assert.deepEqual(cookBatches(s, null), []);
});

test("cookedIds, plannedCook, and Today's cook item agree for every cook", () => {
  for (const v of [
    { start: s.weekStart, plan: s.plan! },
    { start: s.next.start, plan: s.next.plan! },
  ]) {
    const done = cookedIds(s, v.start);
    for (const c of v.plan.cooks) {
      const cooked = done.has(c.id);
      assert.equal(plannedCook(s, c.recipe, c.id)?.done, cooked, `plannedCook '${c.id}'`);
      const item = routineFor(s, c.date).find((i) => i.key === `cook-${c.id}`);
      assert.equal(item?.done, cooked, `Today '${c.id}'`);
    }
  }
});
