import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate } from "./allocate.ts";
import { afford, budgetView, type BudgetData, type Goal } from "./budget.ts";
import { affordCheck, displacesText, inYourTerms } from "./displaces.ts";

// Made-up money: £160 a week to live on, paid £2,280 on the last working day, saving for two things.
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
  balancePence: 150_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [],
  income: [{ fromOn: "2026-12-31", pence: 228_000, grossYearPence: null }],
  goals: [goal({}), goal({ id: 2, name: "Holiday", targetPence: 60_000, position: 2 })],
  ...o,
});
const TODAY = "2026-11-18";

test("a cost is put as days of the weekly amount, to one decimal", () => {
  assert.equal(inYourTerms(plan(), TODAY, 6_000).days_of_weekly_amount, 2.6);
  assert.equal(inYourTerms(plan(), TODAY, 16_000).days_of_weekly_amount, 7);
  assert.equal(inYourTerms(plan({ allowancePence: null }), TODAY, 6_000).days_of_weekly_amount, null);
});

test("and as how much later the first goal still being saved for gets there", () => {
  const data = plan();
  const payday = allocate(data, budgetView(data, TODAY).payday);
  assert.ok(payday, "the made-up pay gives a payday plan");
  const first = payday.shares.find((s) => s.kind !== "debt" && s.remaining > 0 && s.pence > 0);
  assert.ok(first, "a goal is getting a share");
  assert.equal(first.name, "Emergency fund");

  const later = inYourTerms(data, TODAY, 6_000).first_goal_later_by_weeks;
  assert.deepEqual(later, { goal: "Emergency fund", weeks: Math.ceil((6_000 / first.pence) * (payday.weeks || 4.3)) });
  assert.ok(later && later.weeks >= 1);
  // Twice the cost puts it off for about twice as long.
  const double = inYourTerms(data, TODAY, 12_000).first_goal_later_by_weeks;
  assert.ok(double && double.weeks >= later.weeks);
});

test("with no goal being saved for, or no pay planned, nothing is put off", () => {
  assert.equal(inYourTerms(plan({ goals: [] }), TODAY, 6_000).first_goal_later_by_weeks, null);
  assert.equal(inYourTerms(plan({ income: [] }), TODAY, 6_000).first_goal_later_by_weeks, null);
});

test("the whole check is the verdict and ways to pay, with what it displaces: one answer for the page and for Claude", () => {
  const data = plan();
  const check = affordCheck(data, TODAY, 6_000);
  assert.deepEqual(check, { ...afford(data, TODAY, 6_000), ...inYourTerms(data, TODAY, 6_000) });
  assert.equal(check.verdict, "fits");
  assert.deepEqual(Object.keys(check), [
    "verdict",
    "reason",
    "options",
    "paysBackWeeks",
    "days_of_weekly_amount",
    "first_goal_later_by_weeks",
  ]);
  assert.equal(affordCheck(data, TODAY, 6_000, 2_500).paysBackWeeks, 3);
});

test("what it displaces reads as a line for the page", () => {
  const line = (days: number | null, later: { goal: string; weeks: number } | null) =>
    displacesText({ days_of_weekly_amount: days, first_goal_later_by_weeks: later });
  assert.equal(
    line(2.6, { goal: "Holiday", weeks: 2 }),
    "About 3 days of your weekly amount. Holiday gets there 2 weeks later.",
  );
  assert.equal(
    line(1.2, { goal: "Holiday", weeks: 1 }),
    "About 1 day of your weekly amount. Holiday gets there 1 week later.",
  );
  assert.equal(line(0.4, null), "Less than a day of your weekly amount.");
  assert.equal(line(null, { goal: "Emergency fund", weeks: 3 }), "Emergency fund gets there 3 weeks later.");
  assert.equal(line(null, null), "");
});
