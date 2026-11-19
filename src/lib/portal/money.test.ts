import { test } from "node:test";
import assert from "node:assert/strict";
import type { BudgetData } from "../money/budget.ts";
import type { Bill } from "../money/recurring.ts";
import { gymCost, roleMoney } from "./money.ts";

// Made-up money and a made-up gym.
const gymBill: Bill = {
  id: 4,
  ident: "example-gym",
  merchantKey: "example-gym",
  bandPence: null,
  name: "Example Gym",
  cadence: "monthly",
  anchorOn: "2026-11-02",
  expectedPence: 6_000,
  variable: false,
  category: "fitness",
  status: "active",
  addedBy: "engine",
  createdAt: "",
  lastPaidOn: "2026-11-02",
  lastPence: 6_000,
};
const data = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 100_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: null,
  categories: [
    {
      key: "groceries",
      name: "Groceries",
      kind: "groceries",
      budgetPence: null,
      paidMonth: 0,
      spentWeek: 0,
      spentLastWeek: 0,
    },
  ],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [gymBill],
  ...o,
});
const session = (day: string) => ({ day, workout: "a", finished: true, feel: null, notes: "" });

test("the gym's monthly bill over this month's visits so far", () => {
  const c = gymCost(
    data(),
    [session("2026-10-30"), session("2026-11-03"), session("2026-11-10"), session("2026-11-17")],
    "2026-11-18",
  );
  assert.deepEqual(c, { monthly: 6_000, visits: 3, perVisit: 2_000 });
  assert.equal(gymCost(data({ bills: [] }), [], "2026-11-18"), null, "no gym bill, nothing to say");
});

test("a role's salary: take-home, the change from today's pay, and when the first goal gets there instead", () => {
  const plan = data({
    income: [{ fromOn: "2026-11-30", pence: 150_000, grossYearPence: null }],
    goals: [
      {
        id: 1,
        name: "Emergency fund",
        kind: "saving",
        targetPence: 600_000,
        dueOn: null,
        repeatsYearly: false,
        held: "elsewhere",
        savedPence: 0,
        savedOn: "2026-11-01",
        aprBp: null,
        paymentPence: null,
        merchantKey: null,
        category: null,
        position: 1,
        status: "active",
        addedBy: "owner",
        movedPence: 0,
        spentPence: 0,
      },
    ],
  });
  const lines = roleMoney({ minPence: 4_500_000, maxPence: 5_500_000 }, plan, "2026-11-18");
  assert.equal(lines[0], "About £2,993.30 to £3,538.12 a month after tax and NI.");
  assert.equal(lines[1], "£1,765.71 a month more than your pay now.");
  assert.match(lines[2], /^Emergency fund: there by \w{3} \d{4} instead of \w{3} \d{4}\.$/);
  assert.deepEqual(roleMoney(null, plan, "2026-11-18"), []);
});
