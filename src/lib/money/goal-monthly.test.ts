import { test } from "node:test";
import assert from "node:assert/strict";
import { goalDates, shareOut } from "./allocate.ts";
import type { BudgetData, Goal } from "./budget.ts";
import type { Bill } from "./recurring.ts";

// Made-up money: pay of £1,550 on the 15th, rent of £1,000 on the 1st, no weekly amount.
const rent: Bill = {
  id: 1,
  ident: "example-lettings",
  merchantKey: "example-lettings",
  bandPence: null,
  name: "Rent",
  cadence: "monthly",
  anchorOn: "2026-12-01",
  expectedPence: 100_000,
  variable: false,
  category: "rent",
  status: "active",
  addedBy: "engine",
  createdAt: "",
  lastPaidOn: "2027-01-01",
  lastPence: 100_000,
};

const goal = (o: Partial<Goal>): Goal => ({
  id: 1,
  name: "Example saver",
  kind: "saving",
  targetPence: 240_000,
  dueOn: null,
  repeatsYearly: false,
  held: "elsewhere",
  savedPence: 0,
  savedOn: "2027-01-01",
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

const data = (goals: Goal[]): BudgetData => ({
  balancePence: 30_000,
  allowancePence: 0,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "day-15",
  firstPayday: null,
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [rent],
  income: [{ fromOn: "2027-01-01", pence: 155_000, grossYearPence: null }],
  weeklyFloorPence: 0,
  goals,
});

test("a saving goal with no monthly amount takes everything left over, as before", () => {
  const plan = shareOut(data([goal({})]), "2027-01-15", 155_000);
  assert.equal(plan.shares[0].pence, 55_000);
  assert.equal(plan.surplus, 0);
});

test("a saving goal with a monthly amount takes that and no more; the rest stays in the account", () => {
  const plan = shareOut(data([goal({ paymentPence: 10_000 })]), "2027-01-15", 155_000);
  const share = plan.shares[0];
  assert.equal(share.need, 10_000);
  assert.equal(share.pence, 10_000);
  assert.equal(plan.surplus, 45_000);
});

test("what a capped goal leaves flows to the next goal, and a nearly full one takes only what it lacks", () => {
  const plan = shareOut(
    data([
      goal({ paymentPence: 10_000, targetPence: 50_000, savedPence: 46_000 }),
      goal({ id: 2, name: "Example bike", targetPence: 60_000, position: 2 }),
    ]),
    "2027-01-15",
    155_000,
  );
  assert.equal(plan.shares[0].pence, 4_000);
  assert.equal(plan.shares[1].pence, 51_000);
});

test("a capped goal gets there at its monthly amount: six paydays of £100 for £600", () => {
  const dates = goalDates(data([goal({ paymentPence: 10_000, targetPence: 60_000 })]), "2027-01-15");
  assert.equal(dates.get(1), "2027-06");
});
