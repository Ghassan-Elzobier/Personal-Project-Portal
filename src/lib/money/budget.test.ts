import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowanceFrom,
  budgetView,
  mondayOf,
  monthsTo,
  nextPayday,
  parseBudget,
  parsePounds,
  paydayIn,
  type BudgetData,
} from "./budget.ts";

test("payday is the month's last working day, moved back past weekends and bank holidays", () => {
  assert.equal(paydayIn("2026-12", "last-working-day"), "2026-12-31", "a Thursday");
  assert.equal(paydayIn("2027-01", "last-working-day"), "2027-01-29", "the 31st is a Sunday");
  assert.equal(paydayIn("2026-08", "last-working-day"), "2026-08-28", "the 31st is the summer bank holiday");
  assert.equal(paydayIn("2027-02", "day-28"), "2027-02-26", "a set day on a Sunday moves back to Friday");
  assert.equal(paydayIn("2027-02", "day-31"), "2027-02-26", "a day past the month's end is its last day");
});

test("the next payday is after today, and never before the first payday you set", () => {
  assert.equal(nextPayday("2026-11-18", "last-working-day", null), "2026-11-30");
  assert.equal(nextPayday("2026-11-18", "last-working-day", "2026-12-31"), "2026-12-31", "no pay in November");
  assert.equal(nextPayday("2026-12-31", "last-working-day", "2026-12-31"), "2027-01-29", "on payday, plan to the next");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(monthsTo("2026-11-18", "2026-12-31"), 2);
  assert.equal(monthsTo("2026-12-31", "2027-01-29"), 2);
  assert.equal(monthsTo("2027-01-15", "2027-01-29"), 1);
});

// A made-up plan: rent and savings fixed, groceries and eating out flexible.
const plan = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 300_000,
  allowancePence: 16_000,
  bufferPence: 50_000,
  bufferFrom: "2027-01-29",
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
      key: "savings",
      name: "Savings",
      kind: "savings",
      budgetPence: 20_000,
      paidMonth: 0,
      spentWeek: 0,
      spentLastWeek: 0,
    },
    {
      key: "groceries",
      name: "Groceries",
      kind: "groceries",
      budgetPence: 30_000,
      paidMonth: 4_000,
      spentWeek: 3_500,
      spentLastWeek: 7_000,
    },
    {
      key: "eating-out",
      name: "Eating out",
      kind: "discretionary",
      budgetPence: 6_000,
      paidMonth: 0,
      spentWeek: 0,
      spentLastWeek: 0,
    },
    {
      key: "transfers",
      name: "Transfers",
      kind: "transfer",
      budgetPence: null,
      paidMonth: 0,
      spentWeek: 9_000,
      spentLastWeek: 0,
    },
  ],
  unsortedWeek: 500,
  unsortedLastWeek: 0,
  ...o,
});

test("before the first pay, December's rent is still to pay and both months' savings, and the buffer waits for its day", () => {
  const v = budgetView(plan(), "2026-11-18");
  assert.equal(v.payday, "2026-12-31");
  assert.equal(v.daysToPayday, 43);
  assert.deepEqual(
    v.stillToPay.map((c) => [c.key, c.pence]),
    [
      ["rent", 50_000],
      ["savings", 40_000],
    ],
  );
  assert.equal(v.buffer, 0, "the buffer starts on 29 January");
  assert.equal(v.safe, 300_000 - 50_000 - 40_000);
  assert.equal(v.perWeek, Math.floor(210_000 / (43 / 7)));
  assert.equal(v.onTrack, true);
});

test("this week's amount is the plan less what you've spent that isn't fixed, unsorted included", () => {
  const v = budgetView(plan(), "2026-11-18");
  assert.equal(v.week.spent, 3_500 + 500, "transfers and fixed costs don't count");
  assert.equal(v.week.carry, 0, "last week came in under");
  assert.equal(v.week.left, 16_000 - 4_000);
});

test("overspending last week comes off this week", () => {
  const v = budgetView(plan({ unsortedLastWeek: 12_000 }), "2026-11-18");
  assert.equal(v.week.carry, 7_000 + 12_000 - 16_000);
  assert.equal(v.week.left, 16_000 - 3_000 - 4_000);
});

test("from the 29 January pay the buffer is held back, and only January's fixed costs are left", () => {
  const v = budgetView(
    plan({ categories: plan().categories.map((c) => ({ ...c, paidMonth: c.key === "rent" ? 50_000 : 0 })) }),
    "2027-01-29",
  );
  assert.equal(v.payday, "2027-02-26");
  assert.equal(v.buffer, 50_000);
  assert.deepEqual(
    v.stillToPay.map((c) => [c.key, c.pence]),
    [
      ["rent", 50_000],
      ["savings", 40_000],
    ],
    "February's rent and January's and February's savings",
  );
});

test("short on money, it says so: the weeks to payday get less than planned", () => {
  const v = budgetView(plan({ balancePence: 120_000 }), "2026-11-18");
  assert.equal(v.safe, 30_000);
  assert.equal(v.onTrack, false);
  assert.equal(budgetView(plan({ balancePence: null }), "2026-11-18").safe, null, "no balance yet, no number");
});

test("with no weekly amount set, it comes from the flexible budgets", () => {
  assert.equal(allowanceFrom(plan({ allowancePence: null })), Math.round(((30_000 + 6_000) * 12) / 52 / 100) * 100);
  assert.equal(allowanceFrom(plan({ allowancePence: null, categories: [] })), null);
});

test("planned purchases: a one-off is spoken for before payday, a spread one takes a share each of its weeks", () => {
  const v = budgetView(
    plan({
      planned: [
        { name: "Bike repair", pence: 6_000, dueOn: "2026-11-10", funding: "spread", weeks: 3 },
        { name: "Train fare", pence: 2_500, dueOn: "2026-11-20", funding: "allowance", weeks: 1 },
        { name: "Laptop", pence: 40_000, dueOn: "2026-12-10", funding: "savings", weeks: 1 },
        { name: "Later", pence: 9_999, dueOn: "2027-02-01", funding: "irregular", weeks: 1 },
      ],
    }),
    "2026-11-18",
  );
  assert.equal(v.plannedBefore, 2_500 + 40_000, "the spread one isn't spoken for up front, and one after payday waits");
  assert.equal(v.week.spread, 2_000 + 2_500, "the bike's weekly share, and the fare due this week");
  assert.equal(v.week.left, 16_000 - 4_000 - 4_500);
  const after = budgetView(
    plan({ planned: [{ name: "Bike repair", pence: 6_000, dueOn: "2026-11-10", funding: "spread", weeks: 2 }] }),
    "2026-11-18",
  );
  assert.equal(after.week.spread, 3_000, "week 2 of 2");
  const done = budgetView(
    plan({ planned: [{ name: "Bike repair", pence: 6_000, dueOn: "2026-11-02", funding: "spread", weeks: 2 }] }),
    "2026-11-18",
  );
  assert.equal(done.week.spread, 0, "its weeks are over");
});

test("amounts typed in pounds become pence, and anything else is refused", () => {
  assert.equal(parsePounds("160"), 16_000);
  assert.equal(parsePounds("£1,200.5"), 120_050);
  assert.equal(parsePounds(" "), null);
  assert.equal(parsePounds("12.345"), undefined);
  assert.equal(parsePounds("-5"), undefined);
});

test("the budget read becomes the plan the sums work on", () => {
  const data = parseBudget({
    balance_pence: 318560,
    settings: {
      allowance_pence: 21400,
      buffer_pence: 20000,
      buffer_from: null,
      payday_rule: "last-working-day",
      first_payday: "2026-12-31",
    },
    categories: [
      {
        key: "rent",
        name: "Rent",
        kind: "bills",
        budget_pence: 50000,
        paid_month: "50000",
        spent_week: 0,
        spent_last_week: 0,
      },
    ],
    unsorted_week: 500,
    unsorted_last_week: 0,
  });
  assert.equal(data.balancePence, 318560);
  assert.equal(data.firstPayday, "2026-12-31");
  assert.equal(data.categories[0].paidMonth, 50000);
  assert.equal(parseBudget(null).balancePence, null, "nothing read, nothing assumed");
});
