import { test } from "node:test";
import assert from "node:assert/strict";
import { debtOrders, monthsToClear, payoff, suggestDebts, withDebtOrder } from "./allocate.ts";
import type { BudgetData, Goal } from "./budget.ts";
import { yearlyPence, type Bill } from "./recurring.ts";

// Debts from the bills: suggesting them, when they clear, and the order to pay extra in.
// Made-up money. The cycle runs from the 31 December payday to 29 January: 29 days.
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

test("a regular repayment in Debt repayments is suggested as a debt with its monthly payment, until a debt goal follows its lender", () => {
  const loan = bill({
    id: 7,
    ident: "example-loans",
    merchantKey: "example-loans",
    name: "Loan to Example Ltd",
    expectedPence: 12_000,
    category: "debts",
  });
  const weekly = bill({
    id: 8,
    ident: "example-card",
    merchantKey: "example-card",
    name: "Card",
    cadence: "weekly",
    expectedPence: 1_000,
    category: "debts",
  });
  const ended = bill({ id: 9, ident: "example-old", merchantKey: "example-old", category: "debts", status: "ended" });
  const data = plan({ bills: [bill({}), loan, weekly, ended], goals: [] });
  assert.deepEqual(suggestDebts(data), [
    { billId: 7, name: "Loan to Example Ltd", paymentPence: 12_000 },
    { billId: 8, name: "Card", paymentPence: Math.round(yearlyPence(weekly) / 12) },
  ]);
  const watched = plan({
    bills: [bill({}), loan],
    goals: [
      goal({ id: 3, name: "Loan", kind: "debt", targetPence: null, merchantKey: "example-loans", savedPence: 200_000 }),
    ],
  });
  assert.deepEqual(suggestDebts(watched), []);
});

test("payoff: no interest clears in whole payments; interest adds months and the interest paid", () => {
  assert.deepEqual(payoff(100_000, 10_000, 0), { months: 10, interestPence: 0 });
  const dear = payoff(100_000, 10_000, 2_000);
  assert.equal(dear.months, monthsToClear(100_000, 10_000, 2_000));
  assert.ok(dear.months! > 10);
  assert.ok(dear.interestPence > 0 && dear.interestPence < 20_000);
  assert.equal(payoff(100_000, 1_000, 2_000).months, null, "a payment the interest eats never clears");
  assert.deepEqual(payoff(0, 10_000, 2_000), { months: 0, interestPence: 0 });
});

test("debt orders: highest interest first, or smallest balance first, each with when the last clears and the interest", () => {
  const card = { id: 1, owed: 300_000, payment: 10_000, aprBp: 2_490 };
  const loan = { id: 2, owed: 80_000, payment: 5_000, aprBp: 600 };
  const [rate, balance] = debtOrders([loan, card], 5_000);
  assert.equal(rate.by, "rate");
  assert.deepEqual(rate.order, [1, 2]);
  assert.deepEqual(balance.order, [2, 1]);
  assert.ok(rate.interestPence < balance.interestPence, "paying the dearest first costs less interest");
  assert.ok(rate.months! > 0 && balance.months! > 0);
  // With no extra, payments still roll on once a debt clears.
  const [slow] = debtOrders([loan, card], 0);
  assert.ok(slow.months! < payoff(card.owed, card.payment, card.aprBp).months!);
});

test("a debt order moves only the debts: the other goals keep their places", () => {
  const goals = [
    goal({ id: 1, position: 1 }),
    goal({ id: 2, kind: "debt", position: 2 }),
    goal({ id: 3, position: 3, status: "paused" }),
    goal({ id: 4, kind: "debt", position: 4 }),
    goal({ id: 5, position: 5, status: "done" }),
  ];
  assert.deepEqual(withDebtOrder(goals, [4, 2]), [1, 4, 3, 2]);
});
