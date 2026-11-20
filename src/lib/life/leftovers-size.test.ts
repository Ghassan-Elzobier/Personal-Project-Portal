import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { assign, sizeCooks, spare, type Placement, type Routine, type StockBatch, type WeekPlan } from "./planner.ts";
import { weekNeeds } from "./shopping.ts";
import { buildState, stockFor, weekView, type Batch, type LifeRaw } from "./state.ts";

// Cooked portions already in the kitchen are eaten first where the week puts them,
// so the cook sessions whose days they feed make that many fewer, and the shopping
// list buys nothing for portions nobody will eat.

const routine: Routine = { breakfast: 360, lunch: 750, shake: 960, dinner: 1140, maxRepeat: 3, lunchAtWork: true };
// A made-up week from Sunday 15 Nov 2026: two mains on Sunday, two on Wednesday.
const week: WeekPlan = {
  start: "2026-11-15",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "b", recipe: "butter-chicken", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "c", recipe: "cottage-pie", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
    { id: "d", recipe: "shawarma-bowls", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
  ],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
};
const KCAL = 2900;
/** Fridge-only leftovers (they don't freeze), so the week eats them first. */
const leftover = (gid: string, recipe: string, left: number): StockBatch => ({
  gid,
  recipe,
  cookedOn: "2026-11-15",
  left,
  location: "fridge",
  scale: 1,
});
const portions = (plan: WeekPlan, ids: string[]) =>
  plan.cooks.filter((c) => ids.includes(c.id)).reduce((t, c) => t + c.portions, 0);
const mealsAfterFirstCook = (placed: Placement[]) =>
  placed.filter((p) => (p.slot === "lunch" || p.slot === "dinner") && p.id !== "2026-11-15:lunch");

test("with nothing cooked in the kitchen, cooks are sized as before", () => {
  const before = sizeCooks(week, routine, KCAL);
  assert.deepEqual(sizeCooks(week, routine, KCAL, []), before);
  assert.deepEqual(sizeCooks(week, routine, KCAL, [leftover("x", "batata-traybake", 0)]), before);
  // A portion eaten before the first cook is ready feeds no session's days.
  const gapOnly: StockBatch = {
    gid: "z",
    recipe: "lasagne",
    cookedOn: "2026-11-01",
    left: 1,
    location: "freezer",
    scale: 1,
  };
  assert.deepEqual(sizeCooks(week, routine, KCAL, [gapOnly]), before);
});

test("a fridge-only leftover shrinks the first session's cook, and the list buys less", () => {
  const stock = [leftover("x", "batata-traybake", 3)];
  const before: WeekPlan = { ...week, cooks: sizeCooks(week, routine, KCAL) };
  const after: WeekPlan = { ...week, cooks: sizeCooks(week, routine, KCAL, stock) };
  const placed = assign(after, routine, stock, KCAL);
  // Sunday's lunch comes before the cook; the other two portions feed Sunday's session's days.
  const fed = placed.filter((p) => p.batchGid === "x" && p.id !== "2026-11-15:lunch").length;
  assert.equal(fed, 2);
  assert.equal(portions(after, ["a", "b"]), portions(before, ["a", "b"]) - fed);
  assert.equal(portions(after, ["c", "d"]), portions(before, ["c", "d"]));
  // Every lunch and dinner still has food, and no extra portion is left to freeze.
  assert.ok(mealsAfterFirstCook(placed).every((p) => p.source !== "none"));
  const spareOf = (plan: WeekPlan, stockIn: StockBatch[]) =>
    spare(plan, assign(plan, routine, stockIn, KCAL)).reduce((t, s) => t + s.portions, 0);
  assert.equal(spareOf(after, stock), spareOf(before, []));
  // The list buys less: nothing more of anything, and less of what Sunday's dishes use.
  const need = (plan: WeekPlan, stockIn: StockBatch[]) =>
    new Map(weekNeeds(plan, assign(plan, routine, stockIn, KCAL)).map((n) => [n.item, n.qty]));
  const was = need(before, []);
  const now = need(after, stock);
  for (const [item, qty] of now) assert.ok(qty <= (was.get(item) ?? 0) + 1e-9, `'${item}'`);
  assert.ok(now.get("beef-mince")! < was.get("beef-mince")!);
});

test("leftovers filling the first session's days take its cook down to two portions a dish", () => {
  const stock = [leftover("x", "batata-traybake", 3), leftover("y", "ginger-lime-noodles", 3)];
  const after: WeekPlan = { ...week, cooks: sizeCooks(week, routine, KCAL, stock) };
  assert.deepEqual(
    after.cooks.filter((c) => c.id === "a" || c.id === "b").map((c) => c.portions),
    [2, 2],
  );
  assert.equal(portions(after, ["c", "d"]), portions({ ...week, cooks: sizeCooks(week, routine, KCAL) }, ["c", "d"]));
  assert.ok(mealsAfterFirstCook(assign(after, routine, stock, KCAL)).every((p) => p.source !== "none"));
});

// The stock a week is sized with is what it can really use.
const profile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const batch = (over: Partial<Batch> & Pick<Batch, "gid" | "recipe">): Batch => ({
  cookedOn: "2026-11-15",
  portions: 4,
  remaining: 4,
  scale: 1,
  location: "fridge",
  planStart: null,
  cookId: null,
  ...over,
});
const raw: LifeRaw = {
  profile,
  weights: [],
  plans: [
    { start: "2026-11-15", data: { ...week, cooks: sizeCooks(week, routine, KCAL), createdOn: "2026-11-14" } },
    { start: "2026-11-22", data: { ...week, start: "2026-11-22", cooks: [], createdOn: "2026-11-16" } },
  ],
  meals: [
    {
      day: "2026-11-15",
      slot: "lunch",
      status: "eaten",
      recipe: "batata-traybake",
      batchGid: "old",
      kcal: 700,
      protein: 40,
      note: null,
    },
  ],
  batches: [
    // Made by this week's own Sunday cook.
    batch({ gid: "own", recipe: "bolognese", planStart: "2026-11-15", cookId: "a" }),
    // Last week's leftover: three portions, one eaten on Sunday.
    batch({ gid: "old", recipe: "batata-traybake", cookedOn: "2026-11-14", portions: 3, remaining: 2 }),
  ],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
};

test("this week is sized with leftovers as it found them, never its own cooks", () => {
  const s = buildState(raw, "2026-11-16");
  assert.deepEqual(
    stockFor(s, weekView(s, "this")).map((b) => [b.gid, b.left]),
    [["old", 3]],
  );
});

test("next week is sized with what this week's meals leave", () => {
  const s = buildState(raw, "2026-11-16");
  const logged = new Set(s.meals.map((m) => `${m.day}:${m.slot}`));
  const taking = (gid: string) => s.placements.filter((p) => p.batchGid === gid && !logged.has(p.id)).length;
  // This week's meals still take every portion of its own batch, and one of the two leftovers.
  assert.equal(taking("own"), 4);
  assert.equal(taking("old"), 1);
  assert.deepEqual(
    stockFor(s, s.next).map((b) => [b.gid, b.left]),
    [["old", 1]],
  );
});
