import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, suggestGoals } from "./allocate.ts";
import { budgetView, fixedMonthly, parseBudget, typicalCosts, type BudgetCategory, type BudgetData } from "./budget.ts";
import { forecast } from "./forecast.ts";
import type { Bill } from "./recurring.ts";

// A bills category Money can't find a bill for (energy with refunds, rent at changing
// amounts) counts at its typical month: the median of the months it was paid in, of the
// last 6 full ones. Made-up money; today Wednesday 18 November 2026.
const TODAY = "2026-11-18";
const MONTHS = [0, 52_000, 61_000, 0, 58_000, 55_000];

const energy = (o: Partial<BudgetCategory> = {}): BudgetCategory => ({
  key: "energy",
  name: "Energy",
  kind: "bills",
  budgetPence: null,
  paidMonth: 0,
  spentWeek: 0,
  spentLastWeek: 0,
  months: MONTHS,
  ...o,
});
const rentBill: Bill = {
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
};
const data = (categories: BudgetCategory[], o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 300_000,
  allowancePence: 0,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: null,
  categories,
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [],
  income: [{ fromOn: "2026-11-30", pence: 200_000, grossYearPence: null }],
  lastPay: null,
  ...o,
});

test("a bills category with no budget or bill, paid in 3 of the last 6 months, counts at its typical month", () => {
  assert.deepEqual(fixedMonthly(energy()), { pence: 56_500, source: "typical", paidMonths: 4 });
  const v = budgetView(data([energy()]), TODAY);
  assert.deepEqual(v.stillToPay, [{ key: "energy", name: "Energy", pence: 56_500, typical: true }]);
  assert.equal(v.safe, 300_000 - 56_500);
  assert.equal(
    budgetView(data([energy({ paidMonth: 20_000 })]), TODAY).stillToPay[0].pence,
    36_500,
    "less what has gone out this month",
  );
});

test("with only 2 months paid, or for savings, there is no typical month", () => {
  const two = energy({ months: [0, 0, 61_000, 0, 0, 55_000] });
  assert.equal(fixedMonthly(two), null);
  assert.deepEqual(budgetView(data([two]), TODAY).stillToPay, []);
  assert.equal(fixedMonthly(energy({ key: "savings", kind: "savings" })), null, "transfers to savings are no cost");
  assert.equal(fixedMonthly(energy({ kind: "essentials" })), null, "flexible spending is the weekly amount's");
});

test("a set budget or a bill found wins over the typical month", () => {
  assert.deepEqual(fixedMonthly(energy({ budgetPence: 40_000 })), { pence: 40_000, source: "budget", paidMonths: 0 });
  assert.equal(fixedMonthly(energy({ budgetPence: 0 })), null, "a budget of 0 counts nothing");
  const rent = energy({ key: "rent", name: "Rent" });
  const v = budgetView(data([rent], { bills: [rentBill], firstPayday: "2026-12-31" }), TODAY);
  assert.deepEqual(
    v.stillToPay.map((c) => c.key),
    ["bill-1"],
    "the bill counts on its day, the category not again",
  );
  assert.deepEqual(typicalCosts(data([rent], { bills: [rentBill] }), TODAY), []);
});

test("the forecast and the payday share-out count the typical month as they would the same budget", () => {
  const typical = data([energy()]);
  const budgeted = data([energy({ budgetPence: 56_500, months: undefined })]);
  const none = data([energy({ months: undefined })]);
  const last = (d: BudgetData) => forecast(d, TODAY)!.points.at(-1)!.pence;
  assert.equal(last(typical), last(budgeted));
  assert.ok(last(typical) < last(none), "it comes out of the 13-week balance");

  const a = allocate(typical, "2026-11-30")!;
  assert.equal(a.commitments, allocate(budgeted, "2026-11-30")!.commitments);
  assert.ok(a.commitments > allocate(none, "2026-11-30")!.commitments);
  assert.equal(
    allocate(data([energy({ budgetPence: 10_000 })]), "2026-11-30")!.commitments,
    allocate(data([energy({ budgetPence: 10_000, months: undefined })]), "2026-11-30")!.commitments,
    "a set budget wins",
  );
});

test("the page is told where each typical figure came from", () => {
  assert.deepEqual(typicalCosts(data([energy()]), TODAY), [
    { key: "energy", name: "Energy", pence: 56_500, paidMonths: 4, since: "2026-06" },
  ]);
  assert.deepEqual(typicalCosts(data([energy({ budgetPence: 56_500 })]), TODAY), [], "once saved, it's a budget");
});

test("money_budget's months are read per category", () => {
  const d = parseBudget({ categories: [{ key: "energy", kind: "bills", months: [0, "52000", null, 1, 2, 3] }] });
  assert.deepEqual(d.categories[0].months, [0, 52_000, 0, 1, 2, 3]);
  assert.equal(parseBudget({ categories: [{ key: "energy" }] }).categories[0].months, undefined);
});

test("the emergency fund counts three months of essential outgoings: bills found, unbilled bills categories, groceries and essentials", () => {
  const cat = (key: string, kind: string, budgetPence: number | null, months?: number[]): BudgetCategory => ({
    key,
    name: key,
    kind,
    budgetPence,
    paidMonth: 0,
    spentWeek: 0,
    spentLastWeek: 0,
    months,
  });
  const energyBill: Bill = {
    ...rentBill,
    id: 2,
    ident: "example-energy",
    merchantKey: "example-energy",
    name: "Energy",
    expectedPence: 7_000,
    category: "energy",
  };
  const d = data(
    [
      cat("groceries", "groceries", 30_000),
      cat("transport", "essentials", 8_000),
      cat("water", "bills", null, MONTHS),
      cat("broadband-phone", "bills", 3_000),
      cat("rent", "bills", 99_000, [50_000, 50_000, 50_000, 50_000, 50_000, 50_000]),
      cat("savings", "savings", 20_000),
      cat("eating-out", "discretionary", 10_000),
    ],
    { bills: [rentBill, energyBill], goals: [] },
  );
  // Bills found: rent £500 and energy £70 a month. Water's typical month £565, broadband
  // £30 (rent's budget is the bill's), groceries £300, transport £80: £1,545 a month,
  // three times over is £4,635, up to the next £100.
  assert.equal(suggestGoals(d, TODAY)[0].targetPence, 470_000);
});
