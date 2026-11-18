import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetView, parseBudget, type BudgetData } from "./budget.ts";
import type { Bill } from "./recurring.ts";

// A made-up month: rent budgeted at £500, and Money has found the rent paid on the 8th.
const rentBill = (o: Partial<Bill> = {}): Bill => ({
  id: 3,
  ident: "example-lettings",
  merchantKey: "example-lettings",
  bandPence: null,
  name: "Example Lettings",
  cadence: "monthly",
  anchorOn: "2026-11-08",
  expectedPence: 50_000,
  variable: false,
  category: "rent",
  status: "active",
  addedBy: "engine",
  createdAt: "2026-11-01T05:30:00Z",
  lastPaidOn: "2026-11-08",
  lastPence: 50_000,
  ...o,
});

const plan = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 200_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [
    {
      key: "rent",
      name: "Rent",
      kind: "bills",
      budgetPence: 50_000,
      paidMonth: 50_000,
      spentWeek: 0,
      spentLastWeek: 0,
    },
    {
      key: "energy",
      name: "Energy",
      kind: "bills",
      budgetPence: 7_000,
      paidMonth: 0,
      spentWeek: 0,
      spentLastWeek: 0,
    },
  ],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [rentBill()],
  ...o,
});

test("a bill Money found counts on its own days to payday, in place of its category's monthly estimate", () => {
  const v = budgetView(plan(), "2026-11-18");
  // Rent: paid on 8 Nov, so only 8 Dec is still to pay before the 31 Dec payday (not 2 × £500 − £500 by months).
  assert.deepEqual(v.stillToPay[0], { key: "bill-3", name: "Example Lettings", pence: 50_000, on: "2026-12-08" });
  // Energy has no bill found, so it keeps the estimate: £70 for November and December, none paid yet.
  assert.deepEqual(v.stillToPay[1], { key: "energy", name: "Energy", pence: 14_000 });
  assert.equal(v.safe, 200_000 - 50_000 - 14_000);
});

test("an ignored or ended bill counts nothing, and its category goes back to the estimate", () => {
  for (const status of ["ignored", "ended"] as const) {
    const v = budgetView(plan({ bills: [rentBill({ status })] }), "2026-11-18");
    assert.deepEqual(
      v.stillToPay.map((c) => c.key),
      ["rent", "energy"],
    );
  }
});

test("a bill not paid this month yet counts this month's day as well", () => {
  const v = budgetView(plan({ bills: [rentBill({ lastPaidOn: "2026-10-08" })] }), "2026-11-05");
  assert.deepEqual(v.stillToPay[0], { key: "bill-3", name: "Example Lettings", pence: 100_000, on: "2026-11-08" });
});

test("a bill in no category is named for its merchant, or 'A bill' when Claude reads it without names", () => {
  const v = budgetView(plan({ bills: [rentBill({ category: null, name: null })] }), "2026-11-18");
  assert.equal(v.stillToPay[0].name, "A bill");
});

test("the budget read brings the bills back", () => {
  const data = parseBudget({
    balance_pence: 1000,
    settings: {},
    categories: [],
    bills: [
      {
        id: 3,
        ident: "example-lettings",
        merchant_key: "example-lettings",
        band_pence: null,
        name: "Example Lettings",
        cadence: "monthly",
        anchor_on: "2026-11-08",
        expected_pence: 50_000,
        variable: false,
        category: "rent",
        status: "active",
        added_by: "engine",
        created_at: "2026-11-01T05:30:00Z",
        last_paid_on: "2026-11-08",
        last_pence: 50_000,
      },
    ],
  });
  assert.deepEqual(data.bills, [rentBill()]);
});
