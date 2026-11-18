import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetView, type BudgetData, type Goal } from "./budget.ts";

// The autopilot's weekly amount. Made-up money: today Wednesday 18 November, payday
// Monday 30 November, so two weeks from this Monday to payday; £30 spent so far this week.
const TODAY = "2026-11-18";
const plan = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 50_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: null,
  categories: [],
  unsortedWeek: 3_000,
  unsortedLastWeek: 0,
  weeklyFloorPence: 12_000,
  ...o,
});

test("with room to spare, the week gets the target", () => {
  const w = budgetView(plan(), TODAY).week;
  assert.equal(w.auto, true);
  assert.equal(w.allowance, 16_000);
  assert.equal(w.left, 13_000);
});

test("in between, the week gets what's safe from Monday over the weeks to payday, in whole pounds", () => {
  // (£250 left + £30 spent) over 2 weeks.
  assert.equal(budgetView(plan({ balancePence: 25_000 }), TODAY).week.allowance, 14_000);
});

test("short, the week never goes under the floor", () => {
  assert.equal(budgetView(plan({ balancePence: 20_000 }), TODAY).week.allowance, 12_000);
});

test("the amount fixed on Monday holds all week, and nothing carries over: an overspend lowers the weeks after by itself", () => {
  const w = budgetView(plan({ weekAmount: { of: "2026-11-16", pence: 15_000 }, unsortedLastWeek: 40_000 }), TODAY).week;
  assert.equal(w.allowance, 15_000);
  assert.equal(w.carry, 0);
  const lastWeek = budgetView(plan({ weekAmount: { of: "2026-11-09", pence: 15_000 } }), TODAY).week;
  assert.equal(lastWeek.allowance, 16_000, "last week's fixed amount isn't this week's");
});

test("money set aside in the account for a goal is spoken for", () => {
  const putBy: Goal = {
    id: 1,
    name: "Christmas",
    kind: "sinking",
    targetPence: 20_000,
    dueOn: "2026-12-20",
    repeatsYearly: true,
    held: "account",
    savedPence: 30_000,
    savedOn: "2026-11-01",
    aprBp: null,
    paymentPence: null,
    merchantKey: null,
    category: "gifts",
    position: 1,
    status: "active",
    addedBy: "owner",
    movedPence: 0,
    spentPence: 5_000,
  };
  const v = budgetView(plan({ goals: [putBy] }), TODAY);
  assert.equal(v.held, 25_000, "£300 set aside, £50 spent from it");
  assert.equal(v.safe, 25_000);
  assert.equal(v.week.allowance, 14_000);
});

test("without a floor, the weekly amount is the plan's, as before", () => {
  const w = budgetView(plan({ weeklyFloorPence: null, balancePence: 20_000 }), TODAY).week;
  assert.equal(w.auto, false);
  assert.equal(w.allowance, 16_000);
});
