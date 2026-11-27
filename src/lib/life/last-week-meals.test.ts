// Last meal week's unticked meals: their portions still count as stock until they
// are logged, so "I ate them" offers them on the new week's first days.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, unlogged, type Batch, type LifeRaw, type MealLog } from "./state.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";

const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  routine: { ...DEFAULT_PROFILE.routine, shake: 510 },
};
const LAST = "2026-11-15";
const NEW = "2026-11-22";
const plan0: WeekPlan = {
  start: LAST,
  cooks: [
    { id: "a", recipe: "bolognese", date: LAST, start: 990, portions: 0, scale: 1 },
    { id: "b", recipe: "cottage-pie", date: LAST, start: 990, portions: 0, scale: 1 },
  ],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  createdOn: LAST,
};
const plan = { ...plan0, cooks: sizeCooks(plan0, profile.routine as never, 2700) };
const batch = (cookId: string, recipe: string, remaining: number): Batch => ({
  gid: `g-${cookId}`,
  recipe,
  cookedOn: LAST,
  portions: plan.cooks.find((c) => c.id === cookId)!.portions,
  remaining,
  scale: 1,
  location: "fridge",
  planStart: LAST,
  cookId,
});
const raw = (batches: Batch[], meals: MealLog[] = []): LifeRaw => ({
  profile,
  weights: [{ day: LAST, kg: 65 }],
  plans: [{ start: LAST, data: plan }],
  meals,
  batches,
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
});

/** Last week's meals from a batch, latest first, with every other meal logged. */
function setUp(remaining: { a: number; b: number }) {
  const batches = [batch("a", "bolognese", remaining.a), batch("b", "cottage-pie", remaining.b)];
  const placed = buildState(raw(batches), NEW).prev.placements;
  const last = (gid: string) =>
    placed.filter((p) => p.batchGid === gid && p.date < NEW).sort((x, y) => y.date.localeCompare(x.date))[0];
  const a = last("g-a");
  const b = last("g-b");
  const meals: MealLog[] = placed
    .filter((p) => p !== a && p !== b)
    .map((p) => ({
      day: p.date,
      slot: p.slot,
      status: "eaten",
      recipe: p.recipe,
      batchGid: null,
      kcal: null,
      protein: null,
      note: null,
    }));
  return { batches, meals, a, b };
}

test("on the new week's first day, last week's unticked meal from a batch with a portion left is missed", () => {
  const { batches, meals, a, b } = setUp({ a: 1, b: 0 });
  assert.ok(a && b, "both cooks feed last week's meals");
  const s = buildState(raw(batches, meals), NEW);
  assert.equal(s.weekStart, NEW);
  const missing = unlogged(s, s.today);
  assert.ok(missing.some((p) => p.date === a.date && p.slot === a.slot && p.batchGid === "g-a"));
  assert.ok(
    !missing.some((p) => p.date === b.date && p.slot === b.slot),
    "a meal whose batch has nothing left is not offered",
  );
});

test("no more of last week's meals are offered than their batch has left", () => {
  const batches = [batch("a", "bolognese", 1), batch("b", "cottage-pie", 0)];
  const s = buildState(raw(batches), NEW);
  const fromA = unlogged(s, s.today).filter((p) => p.batchGid === "g-a");
  assert.equal(fromA.length, 1);
});

test("once logged with its batch, last week's meal is not missed and its portion is not stock", () => {
  const { batches, meals, a } = setUp({ a: 1, b: 0 });
  const before = buildState(raw(batches, meals), NEW);
  assert.ok(
    before.open.some((x) => x.gid === "g-a"),
    "the unticked portion counts as stock",
  );
  const eaten: MealLog = {
    day: a.date,
    slot: a.slot,
    status: "eaten",
    recipe: a.recipe,
    batchGid: "g-a",
    kcal: null,
    protein: null,
    note: null,
  };
  const after = buildState(
    raw(
      batches.map((x) => (x.gid === "g-a" ? { ...x, remaining: 0 } : x)),
      [...meals, eaten],
    ),
    NEW,
  );
  assert.deepEqual(unlogged(after, after.today), []);
  assert.ok(!after.open.some((x) => x.gid === "g-a"));
  assert.ok(!after.placements.some((p) => p.batchGid === "g-a"), "the new week plans nothing from it");
});

test("last week's meals are not offered once the week before is gone", () => {
  const { batches } = setUp({ a: 1, b: 1 });
  const s = buildState(raw(batches), "2026-11-29");
  assert.deepEqual(unlogged(s, s.today), []);
});
