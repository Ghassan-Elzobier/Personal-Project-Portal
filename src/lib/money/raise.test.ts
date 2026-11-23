import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, goalDates } from "./allocate.ts";
import { allowanceFrom, raiseAhead, raiseExtra, type BudgetData, type Goal } from "./budget.ts";
import type { Bill } from "./recurring.ts";

// Where a pay rise goes (Save More Tomorrow): the share the owner chose goes to goals,
// the rest raises the weekly amount, goal dates walk the paydays ahead, and a goal the
// lower pay can't keep at its pace is held until the higher pay, not behind.
//
// Made-up money, as in allocate.test.ts. The cycle runs from the 31 December payday to 29 January.
const bill = (o: Partial<Bill>): Bill => ({
  id: 1,
  ident: "example-lettings",
  merchantKey: "example-lettings",
  bandPence: null,
  name: "Rent",
  cadence: "monthly",
  anchorOn: "2026-11-08",
  expectedPence: 50_000,
  variable: false,
  category: "rent",
  status: "active",
  addedBy: "engine",
  createdAt: "",
  lastPaidOn: "2026-11-08",
  lastPence: 50_000,
  ...o,
});
const goal = (o: Partial<Goal>): Goal => ({
  id: 1,
  name: "Emergency fund",
  kind: "saving",
  targetPence: 430_000,
  dueOn: null,
  repeatsYearly: false,
  held: "elsewhere",
  savedPence: 0,
  savedOn: "2026-11-18",
  aprBp: null,
  paymentPence: null,
  merchantKey: null,
  category: null,
  position: 1,
  status: "active",
  addedBy: "owner",
  movedPence: 0,
  spentPence: 0,
  ...o,
});
const plan = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 100_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [
    bill({}),
    bill({
      id: 2,
      ident: "example-energy",
      merchantKey: "example-energy",
      name: "Energy",
      anchorOn: "2026-11-15",
      expectedPence: 7_000,
      category: "energy",
    }),
  ],
  income: [{ fromOn: "2026-12-31", pence: 228_000, grossYearPence: null }],
  weeklyFloorPence: 12_000,
  goals: [
    goal({}),
    goal({
      id: 2,
      name: "Christmas",
      kind: "sinking",
      targetPence: 20_000,
      dueOn: "2027-12-01",
      held: "account",
      position: 2,
    }),
    goal({
      id: 3,
      name: "Example loan",
      kind: "debt",
      targetPence: null,
      savedPence: 90_000,
      paymentPence: 10_000,
      position: 3,
    }),
  ],
  ...o,
});
const FROM = "2026-12-31";

// A rise: £2,280 a month now, £2,680 from the 29 January payday, chosen on 31 December.
const RISE = "2027-01-29";
const risen = (share: number | null, o: Partial<BudgetData> = {}) =>
  plan({
    income: [
      { fromOn: "2026-11-01", pence: 228_000, grossYearPence: null },
      { fromOn: RISE, pence: 268_000, grossYearPence: null },
    ],
    raiseGoalShareBp: share,
    raiseSince: share === null ? null : FROM,
    ...o,
  });
const toGoals = (data: BudgetData) => allocate(data, RISE)!.shares.reduce((s, x) => s + x.pence, 0);
/** The goals' money on the same payday had the pay stayed at £2,280. */
const unrisen = toGoals(plan({ income: [{ fromOn: "2026-11-01", pence: 228_000, grossYearPence: null }] }));

test("a rise is seen ahead, from the pay now, and the first pay is not a rise", () => {
  assert.deepEqual(raiseAhead(risen(null), "2026-12-31"), { on: RISE, extra: 40_000 });
  assert.equal(raiseAhead(risen(null), RISE), null, "on the higher pay, nothing is ahead");
  assert.equal(raiseAhead(plan({ income: [{ fromOn: RISE, pence: 268_000, grossYearPence: null }] }), FROM), null);
});

test("with pay added from the next payday on, a higher step after it is still a rise ahead", () => {
  const ahead = plan({
    income: [
      { fromOn: "2026-12-31", pence: 228_000, grossYearPence: null },
      { fromOn: RISE, pence: 268_000, grossYearPence: null },
    ],
  });
  assert.deepEqual(raiseAhead(ahead, "2026-12-14"), { on: RISE, extra: 40_000 });
  const chosen = { ...ahead, raiseGoalShareBp: 10_000, raiseSince: "2026-12-14" };
  assert.equal(raiseExtra(chosen, "2026-12-31"), 0, "the first pay is a start, not a rise");
  assert.equal(raiseExtra(chosen, RISE), 40_000);
});

test("half of a rise goes to the goals, and the other half raises the weekly amount", () => {
  const half = risen(5_000);
  assert.ok(toGoals(half) - unrisen >= 20_000, "at least half of the £400 goes to goals");
  assert.equal(allowanceFrom(half, RISE), 16_000 + 4_600, "£200 a month kept, £46 a week");
  assert.equal(allowanceFrom(half, FROM), 16_000, "before the rise, the weekly amount is as it was");
  assert.equal(allocate(half, RISE)!.weekly, 20_600);
});

test("with none of a rise for goals, they get only their pace and the weekly target takes the rise", () => {
  const none = risen(0);
  assert.equal(allowanceFrom(none, RISE), 16_000 + 9_200, "£400 a month kept, £92 a week");
  assert.equal(allocate(none, RISE)!.weekly, 25_200, "raised all the way to the new target");
  assert.ok(toGoals(none) < toGoals(risen(5_000)));
  assert.ok(toGoals(none) - unrisen < 20_000, "the goals don't get the half they would at 50%");
});

test("a rise's share for goals that are full flows back to the weekly amount", () => {
  const full = risen(10_000, { goals: [goal({ targetPence: 1_000 })] });
  const a = allocate(full, RISE)!;
  assert.equal(a.shares[0].pence, 1_000, "up to its room, and no more");
  assert.equal(a.weekly, 16_000, "the target, with nothing of the rise kept");
  assert.ok(a.surplus > 0, "the rest is left, not stuck in a goal");
});

test("the goal dates walk the paydays ahead: a share of the rise brings every goal no later than keeping it all", () => {
  const goals = [goal({ targetPence: 1_500_000 }), ...plan().goals!.slice(1)];
  const at = (share: number) => goalDates(risen(share, { goals }), FROM);
  const half = at(5_000);
  const none = at(0);
  assert.equal(half.size, 3);
  for (const [id, month] of half) {
    assert.ok(month !== null, `goal ${id} gets there within three years`);
    assert.ok(month <= (none.get(id) ?? "9999-12"), `goal ${id}: ${month} at half, ${none.get(id)} keeping it all`);
  }
  assert.ok(half.get(1)! < none.get(1)!, "the first goal gets there sooner");
});

test("pay too low for a goal's pace before a rise holds the goal until the first higher payday, not behind", () => {
  const low = plan({
    income: [
      { fromOn: "2026-11-01", pence: 130_000, grossYearPence: null },
      { fromOn: RISE, pence: 268_000, grossYearPence: null },
    ],
  });
  const [emergency, christmas] = allocate(low, FROM)!.shares;
  for (const s of [emergency, christmas]) {
    assert.equal(s.held, true, `${s.name} is held`);
    assert.equal(s.slipped, false, `${s.name} is not behind`);
    assert.equal(s.startsOn, RISE);
  }
  const after = allocate(low, RISE)!.shares[0];
  assert.equal(after.held, false, "on the higher pay, nothing is held");
});

test("a goal the higher pay still can't keep at its pace stays behind, not held", () => {
  const low = plan({
    income: [
      { fromOn: "2026-11-01", pence: 130_000, grossYearPence: null },
      { fromOn: RISE, pence: 135_000, grossYearPence: null },
    ],
  });
  const [emergency] = allocate(low, FROM)!.shares;
  assert.equal(emergency.slipped, true);
  assert.equal(emergency.held, false);
  assert.equal(emergency.startsOn, null);
});
