import { test } from "node:test";
import assert from "node:assert/strict";
import type { BudgetData, Goal } from "./budget.ts";
import { ongoingPlans, regularSummary, withOngoing } from "./ongoing.ts";
import type { Bill } from "./recurring.ts";

// Claude's money summary says what the Money page's card says about a regular cost:
// the payday it fits from, at the plan and at the recent pace, and when it doesn't,
// what it would need.
//
// Made-up money. Today is Monday 4 January 2027; pay of £1,550 comes on the 15th and
// rent of £1,000 goes on the 1st: £550 spare a month.
const TODAY = "2027-01-04";
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
const cost = (costPence: number): Goal => ({
  id: 7,
  name: "Example class",
  kind: "recurring",
  targetPence: null,
  dueOn: null,
  repeatsYearly: false,
  held: "account",
  savedPence: 0,
  savedOn: "2027-01-01",
  aprBp: null,
  paymentPence: null,
  merchantKey: null,
  category: null,
  position: 1,
  status: "active",
  addedBy: "claude",
  movedPence: 0,
  spentPence: 0,
  regular: {
    costPence,
    cadence: "monthly",
    setupPence: null,
    replacesMerchantKey: null,
    replaceOverlap: false,
    startOn: null,
    weekday: null,
    estimated: true,
    billId: null,
    payments: [],
  },
});
const budget = (g: Goal): BudgetData => ({
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
  goals: [g],
});
const summarise = (g: Goal) => {
  const read = budget(g);
  return regularSummary(g, withOngoing(read, TODAY), ongoingPlans(read, TODAY)[0]);
};

test("a regular cost that fits says the payday it fits from, and counts from then", () => {
  const s = summarise(cost(30_000));
  assert.equal(s.fits_from, "2027-01-15");
  assert.equal(s.counts_from, "2027-01-15");
  assert.equal(s.monthly_pence, 30_000);
  assert.equal(s.at_recent_pace, null, "no recent pace yet");
  assert.equal(s.failing, null);
  assert.equal(s.estimated, true);
});

test("one that never fits says so, which test fails, and what it would need", () => {
  const s = summarise(cost(60_000));
  assert.equal(s.fits_from, null);
  assert.equal(s.counts_from, null);
  assert.equal(s.failing, "keeps-up");
  assert.equal(s.needs_monthly_pence, 5_000, "£600 against £550 spare");
  assert.equal(s.max_pence, 55_000, "the most that fits");
});
