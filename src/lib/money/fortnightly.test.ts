import { test } from "node:test";
import assert from "node:assert/strict";
import { shareOut } from "./allocate.ts";
import type { BudgetData, Goal } from "./budget.ts";
import { withCost } from "./ongoing.ts";
import { following, occurrencesIn, yearlyPence, type Bill } from "./recurring.ts";

// Made-up money. Today is Monday 4 January 2027; pay of £1,550 comes on the 15th, and
// rent of £1,000 on the 1st.
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

const sessions: Goal = {
  id: 1,
  name: "Example sessions",
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
  addedBy: "owner",
  movedPence: 0,
  spentPence: 0,
  // £100 every other Wednesday.
  regular: {
    costPence: 10_000,
    cadence: "fortnightly",
    setupPence: null,
    replacesMerchantKey: null,
    replaceOverlap: false,
    startOn: null,
    weekday: 2,
    estimated: true,
    billId: null,
    payments: [],
  },
};

const data: BudgetData = {
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
  goals: [sessions],
};

test("a fortnightly schedule steps fourteen days and costs 26 payments a year", () => {
  assert.equal(following({ cadence: "fortnightly", anchorOn: "2027-01-20" }, "2027-01-20"), "2027-02-03");
  assert.equal(yearlyPence({ cadence: "fortnightly", expectedPence: 10_000 }), 260_000);
});

test("a cost every two weeks falls on its session day, two or three times a pay cycle", () => {
  // From 15 Jan: 20 Jan, 3 Feb, 17 Feb, 3 Mar, 17 Mar, 31 Mar, 14 Apr...
  const taken = withCost(data, sessions, "2027-01-15", TODAY);
  const made = taken.bills!.find((b) => b.id < 0)!;
  assert.equal(made.cadence, "fortnightly");
  assert.deepEqual(occurrencesIn(made, "2027-01-15", "2027-02-15"), ["2027-01-20", "2027-02-03"]);
  assert.deepEqual(occurrencesIn(made, "2027-03-15", "2027-04-15"), ["2027-03-17", "2027-03-31", "2027-04-14"]);
  assert.equal(shareOut(taken, "2027-01-15", 155_000).commitments, 100_000 + 2 * 10_000);
  assert.equal(shareOut(taken, "2027-03-15", 155_000).commitments, 100_000 + 3 * 10_000);
});
