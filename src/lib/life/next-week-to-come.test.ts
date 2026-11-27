import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { spareToCome, type Cook, type Placement, type WeekPlan } from "./planner.ts";
import { buildState, routineFor, type Batch, type LifeRaw, type MealLog } from "./state.ts";

// A week's last cook often makes more than its own week eats: the spare portions
// are for next week's first meals, kept cold while still in date or frozen. Next
// week shows them before the cook is logged, so its first lunches don't read
// "Nothing planned" on the day of the cook, and the same meals stay put once it is.
//
// A made-up owner whose meal week starts on Sunday: this one is Sunday 15th to
// Saturday 21st, and today is its last day, Saturday 21st, before the cook.

const profile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const TODAY = "2026-11-21";
const cook = (id: string, portions: number): Cook => ({
  id,
  recipe: id.slice(11),
  date: id.slice(0, 10),
  start: 18 * 60,
  portions,
  scale: 1,
});
const week = (start: string, cooks: Cook[]): WeekPlan => ({
  start,
  cooks,
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  mode: "fresh",
  trips: [],
  createdOn: "2026-11-14",
});
// Next week cooks for the first time on Sunday evening: its Sunday and Monday lunches come before.
const next = week("2026-11-22", [cook("2026-11-22-chicken-parm", 2)]);
const state = (cooks: Cook[], batches: Batch[] = [], meals: MealLog[] = []) =>
  buildState(
    {
      profile,
      weights: [],
      plans: [week("2026-11-15", cooks), next].map((data) => ({ start: data.start, data })),
      meals,
      batches,
      ratings: [],
      lastHad: {},
      stock: [],
      products: [],
      sessions: [],
      sets: [],
    } satisfies LifeRaw,
    TODAY,
  );
const meal = (placements: Placement[], date: string, slot: Placement["slot"]) =>
  placements.find((p) => p.date === date && p.slot === slot);
const batchOf = (c: Cook, location: Batch["location"], remaining: number): Batch => ({
  gid: `g-${c.id}-${location}`,
  recipe: c.recipe,
  cookedOn: c.date,
  portions: remaining,
  remaining,
  scale: 1,
  location,
  planStart: "2026-11-15",
  cookId: c.id,
});

const ragu = cook("2026-11-21-sausage-ragu", 3);

test("the week's last cook, not logged yet, feeds next week's first lunches with its spare portions", () => {
  const s = state([ragu]);
  // This week eats one portion: Saturday's dinner.
  assert.equal(meal(s.placements, TODAY, "dinner")?.recipe, "sausage-ragu");
  // The other two are next week's Sunday and Monday lunches, from the fridge.
  for (const date of ["2026-11-22", "2026-11-23"]) {
    const lunch = meal(s.next.placements, date, "lunch");
    assert.equal(lunch?.recipe, "sausage-ragu", date);
    assert.equal(lunch?.storage, "fridge", date);
    assert.equal(lunch?.cookedOn, "2026-11-21", date);
    // There is no batch until the cook is logged.
    assert.equal(lunch?.batchGid, undefined, date);
  }
  // Never more than the cook leaves over.
  assert.equal(s.next.placements.filter((p) => p.recipe === "sausage-ragu").length, 2);
});

test("once the cook is logged, next week's meals stay the same, now taken from its batch", () => {
  // Today's lunch came before the cook, and was something else.
  const lunch: MealLog = {
    day: TODAY,
    slot: "lunch",
    status: "swapped",
    recipe: null,
    batchGid: null,
    kcal: 700,
    protein: 40,
    note: null,
  };
  const before = state([ragu], [], [lunch]);
  const after = state([ragu], [batchOf(ragu, "fridge", 3)], [lunch]);
  const menu = (ps: Placement[]) => ps.map((p) => `${p.id} ${p.recipe ?? "-"} ${p.storage ?? ""}`);
  assert.deepEqual(menu(after.next.placements), menu(before.next.placements));
  assert.equal(meal(after.next.placements, "2026-11-22", "lunch")?.batchGid, "g-2026-11-21-sausage-ragu-fridge");
});

test("a spare portion past its fridge days by then comes from the freezer, defrosted on this week's last evening", () => {
  // Thursday's cook feeds Thursday's dinner to Saturday's: its sixth portion is frozen.
  const s = state([cook("2026-11-19-tuscan-chicken", 6)]);
  const lunch = meal(s.next.placements, "2026-11-22", "lunch");
  assert.equal(lunch?.recipe, "tuscan-chicken");
  assert.equal(lunch?.storage, "freezer");
  assert.equal(lunch?.defrostOn, TODAY);
  // Today, the last day of this week, says to move it to the fridge tonight.
  const defrost = routineFor(s, TODAY).filter((i) => i.kind === "defrost");
  assert.equal(defrost.length, 1);
  assert.match(defrost[0].detail, /Tuscan chicken/);
  assert.match(defrost[0].detail, /tomorrow's lunch/);
});

test("spare food that neither keeps until next week nor freezes is not offered to it", () => {
  // A traybake doesn't freeze, and Thursday's is past its two fridge days by Sunday.
  const s = state([cook("2026-11-19-batata-traybake", 6)]);
  assert.equal(
    s.next.placements.some((p) => p.recipe === "batata-traybake"),
    false,
  );
});

test("what a cook will leave: its spare portions, cold while in date and the rest frozen, nothing once cooked", () => {
  const plan = week("2026-11-15", [ragu, cook("2026-11-19-tuscan-chicken", 6)]);
  const placed = state(plan.cooks).placements;
  // Saturday's dinner is the ragù (Saturday's lunch is the Tuscan chicken, and they
  // differ when they can), so Thursday's dish feeds four meals and has two spare.
  assert.equal(placed.filter((p) => p.recipe === "tuscan-chicken").length, 4);
  const toCome = spareToCome(plan, placed, new Set());
  assert.deepEqual(
    toCome.map((b) => [b.recipe, b.location, b.left, b.cookedOn]),
    [
      ["sausage-ragu", "fridge", 2, "2026-11-21"],
      ["tuscan-chicken", "freezer", 2, "2026-11-19"],
    ],
  );
  // A cook already logged has its batches in the kitchen: nothing is still to come from it.
  assert.deepEqual(
    spareToCome(plan, placed, new Set([ragu.id])).map((b) => b.recipe),
    ["tuscan-chicken"],
  );
});
