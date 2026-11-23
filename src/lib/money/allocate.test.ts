import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, monthsToClear, suggestGoals } from "./allocate.ts";
import { budgetView, type BudgetData, type Goal } from "./budget.ts";
import type { Bill } from "./recurring.ts";

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
const FROM = "2026-12-31";

test("pay covers the bills, the floor, each goal's pace and the weekly target, and the rest goes to the first goal", () => {
  const a = allocate(plan(), FROM)!;
  assert.equal(a.to, "2027-01-29");
  // Rent on 8 Jan, energy on 15 Jan, and the loan's £100 a month for 29 days.
  assert.equal(a.commitments, 50_000 + 7_000 + 9_539);
  assert.equal(a.floor, 49_714);
  const [emergency, christmas, loan] = a.shares;
  assert.equal(emergency.need, 35_834, "£4,300 over a year");
  assert.equal(christmas.need, 1_819, "£200 over the 11 months to December");
  assert.equal(loan.need, 0, "a debt's payment is a bill; extra comes from what's left");
  assert.equal(a.weekly, 16_000, "raised to the target");
  assert.equal(emergency.pence, 228_000 - 66_539 - 49_714 - 1_819 - 16_571);
  assert.equal(a.surplus, 0);
  assert.equal(a.short, false);
  assert.equal(emergency.transfer, true, "kept in a saver: it has to be moved");
  assert.equal(christmas.transfer, false, "kept in the account, on paper");
});

test("short pay keeps the floor, and the goals last in the order slow down first", () => {
  const a = allocate(plan({ income: [{ fromOn: FROM, pence: 130_000, grossYearPence: null }] }), FROM)!;
  const [emergency, christmas] = a.shares;
  assert.equal(emergency.pence, 130_000 - 66_539 - 49_714);
  assert.equal(emergency.slipped, true);
  assert.equal(christmas.pence, 0);
  assert.equal(christmas.slipped, true);
  assert.equal(a.weekly, 12_000, "the floor, not the target");
  assert.equal(a.short, false);
});

test("pay that can't cover the bills and the floor is short, and no goal gets anything", () => {
  const a = allocate(plan({ income: [{ fromOn: FROM, pence: 100_000, grossYearPence: null }] }), FROM)!;
  assert.equal(a.short, true);
  assert.ok(a.shares.every((s) => s.pence === 0));
  assert.equal(allocate(plan({ income: [] }), FROM), null, "no pay planned, no plan");
});

test("a yearly cost whose day has passed is paced to next year's", () => {
  const a = allocate(
    plan({ goals: [goal({ kind: "sinking", targetPence: 20_000, dueOn: "2026-12-01", repeatsYearly: true })] }),
    FROM,
  )!;
  assert.equal(a.shares[0].need, 1_819);
});

test("a debt with interest takes longer to clear, and one whose payment can't beat the interest never clears", () => {
  assert.equal(monthsToClear(90_000, 10_000, null), 9);
  assert.equal(monthsToClear(90_000, 10_000, 1_990), 10);
  assert.equal(monthsToClear(90_000, 1_000, 1_990), null);
});

test("a bill with money put by in a goal counts only what the goal doesn't hold yet", () => {
  const books = bill({
    id: 5,
    ident: "example-books",
    merchantKey: "example-books",
    name: "Books",
    cadence: "yearly",
    anchorOn: "2025-11-25",
    lastPaidOn: "2025-11-25",
    expectedPence: 9_500,
    category: null,
  });
  const putBy = goal({
    id: 9,
    name: "Books",
    kind: "sinking",
    targetPence: 9_500,
    held: "account",
    merchantKey: "example-books",
    savedPence: 6_000,
  });
  const v = budgetView(
    plan({ bills: [books], goals: [putBy], weeklyFloorPence: null, firstPayday: null }),
    "2026-11-18",
  );
  assert.equal(v.stillToPay[0].pence, 3_500);
  assert.equal(v.held, 6_000);
  assert.equal(v.safe, 100_000 - 3_500 - 6_000, "the whole £95 is spoken for, once");
});

test("suggested goals: an emergency fund of three months of bills and groceries, and money put by for each yearly bill", () => {
  const books = bill({
    id: 5,
    ident: "example-books",
    merchantKey: "example-books",
    name: "Books",
    cadence: "yearly",
    anchorOn: "2025-11-25",
    lastPaidOn: "2025-11-25",
    expectedPence: 9_500,
    category: null,
  });
  const data = plan({
    goals: [],
    bills: [...plan().bills!, books],
    categories: [
      {
        key: "groceries",
        name: "Groceries",
        kind: "groceries",
        budgetPence: 30_000,
        paidMonth: 0,
        spentWeek: 0,
        spentLastWeek: 0,
      },
    ],
  });
  const s = suggestGoals(data, "2026-11-18");
  // (£500 + £70) a month + £95 a year, plus £300 of groceries, three times over: £2,633.75, up to the next £100.
  assert.deepEqual(s[0], {
    name: "Emergency fund",
    kind: "saving",
    targetPence: 270_000,
    dueOn: null,
    repeatsYearly: false,
    held: "elsewhere",
    merchantKey: null,
  });
  assert.deepEqual(s[1], {
    name: "Books",
    kind: "sinking",
    targetPence: 9_500,
    dueOn: "2026-11-25",
    repeatsYearly: true,
    held: "account",
    merchantKey: "example-books",
  });
  assert.deepEqual(
    suggestGoals(plan(), "2026-11-18").map((x) => x.name),
    [],
    "no suggestion it already has",
  );
});

test("a pay step ahead moves a goal's finish: a raise brings it closer, a cut pushes it back", () => {
  const steady = plan({ goals: [goal({})] });
  const base = allocate(steady, "2026-12-31")!.shares[0].finish!;
  const step = (pence: number) =>
    allocate(
      { ...steady, income: [...steady.income!, { fromOn: "2027-02-26", pence, grossYearPence: null }] },
      "2026-12-31",
    )!.shares[0].finish!;
  assert.ok(step(400_000) < base, `${step(400_000)} before ${base}`);
  assert.ok(step(200_000) > base, `${step(200_000)} after ${base}`);
  assert.equal(step(228_000), base, "the same pay changes nothing");
});
