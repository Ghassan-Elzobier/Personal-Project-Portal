import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetView, type BudgetData, type Goal } from "./budget.ts";
import { checkIn } from "./checkin.ts";

// Made-up money. Today is Monday 16 November 2026; last week began Monday 9 November.
const MONDAY = "2026-11-16";
const goal = (o: Partial<Goal> = {}): Goal => ({
  id: 1,
  name: "Example fund",
  kind: "saving",
  targetPence: 100_000,
  dueOn: null,
  repeatsYearly: false,
  held: "account",
  savedPence: 20_000,
  savedOn: "2026-10-01",
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
/** £150 a week to live on; last week spent `spent`, most of it eating out. */
const data = (spent: number, o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 150_000,
  allowancePence: 15_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: null,
  categories: [
    {
      key: "eating-out",
      name: "Eating out",
      kind: "discretionary",
      budgetPence: null,
      paidMonth: 0,
      spentWeek: 0,
      spentLastWeek: spent,
      weeks: [2_000, 2_000, 1_800, 2_200, 2_000, 2_100, 1_900, spent],
    },
  ],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  ...o,
});
const check = (d: BudgetData, today = MONDAY) => checkIn(d, budgetView(d, today), today);

test("on a Monday after an over week: the line, the category that moved most, and the ways to deal with it", () => {
  const c = check(data(18_000, { goals: [goal()] }));
  assert.ok(c);
  assert.equal(c.week, "2026-11-09");
  assert.equal(c.over, 3_000);
  assert.equal(c.line, "Last week: £180.00 of £150.00, £30.00 over.");
  assert.equal(c.moved, "Eating out £180.00, usually £20.00.");
  assert.equal(c.note, "Keep the plan and it comes off this week.");
  assert.deepEqual(c.options, [
    { choice: "keep", label: "Keep the plan" },
    { choice: "goal", label: "Cover it from Example fund", goal: 1 },
  ]);
});

test("taking it off this week is only offered on the autopilot, once this week's amount is fixed", () => {
  const lastWeek = { week: "2026-11-09", amountPence: 15_000, spentPence: 18_000, swept: [] };
  const auto = data(18_000, {
    weeklyFloorPence: 10_000,
    lastWeek,
    weekAmount: { of: MONDAY, pence: 14_000 },
  });
  const c = check(auto);
  assert.deepEqual(
    c?.options.map((o) => o.choice),
    ["keep", "week"],
  );
  assert.equal(c?.note, "Keep the plan and the weeks to payday share it.");
  assert.deepEqual(
    check({ ...auto, weekAmount: null })?.options.map((o) => o.choice),
    ["keep"],
    "not before the engine has fixed this week",
  );
});

test("no 'Cover it from' when no goal kept in the account holds enough", () => {
  const choices = (goals: Goal[]) => check(data(18_000, { goals }))?.options.map((o) => o.label);
  assert.deepEqual(choices([goal({ savedPence: 2_999 })]), ["Keep the plan"]);
  assert.deepEqual(choices([goal({ held: "elsewhere" })]), ["Keep the plan"]);
  assert.deepEqual(choices([goal({ kind: "debt" })]), ["Keep the plan"]);
  assert.deepEqual(choices([goal({ savedPence: 20_000, spentPence: 18_000 })]), ["Keep the plan"], "what it holds now");
  assert.deepEqual(
    choices([goal({ id: 1, name: "Small", savedPence: 1_000 }), goal({ id: 2, name: "Big", position: 2 })]),
    ["Keep the plan", "Cover it from Big"],
    "the first goal, in the plan's order, that holds enough",
  );
});

test("under its amount: says where the leftover went, with one tap", () => {
  const c = check(
    data(12_000, {
      weeklyFloorPence: 10_000,
      lastWeek: {
        week: "2026-11-09",
        amountPence: 15_000,
        spentPence: 12_000,
        swept: [{ goal: 1, name: "Example fund", pence: 3_000 }],
      },
    }),
  );
  assert.equal(c?.line, "Last week: £120.00 of £150.00, £30.00 under.");
  assert.equal(c?.note, "What was left went to your goals: £30.00 to Example fund.");
  assert.deepEqual(c?.options, [{ choice: "ok", label: "Got it" }]);
  assert.equal(check(data(12_000))?.note, "What was left stays in what's safe to spend.");
});

test("null on Thursday, after a week with no spending, without the bank, or once checked in", () => {
  assert.ok(check(data(18_000), "2026-11-18"), "still there on Wednesday");
  assert.equal(check(data(18_000), "2026-11-19"), null);
  assert.equal(check(data(0)), null);
  assert.equal(check(data(18_000, { balancePence: null })), null);
  assert.equal(
    check(data(18_000, { checkin: { week: "2026-11-09", choice: "keep", goal: null, pence: 3_000 } })),
    null,
  );
  assert.ok(
    check(data(18_000, { checkin: { week: "2026-11-02", choice: "keep", goal: null, pence: 3_000 } })),
    "a check-in on an older week does not count",
  );
});

test("covering last week from a goal clears what it would take off this week", () => {
  const over = data(18_000);
  assert.equal(budgetView(over, MONDAY).week.carry, 3_000);
  const covered = { ...over, checkin: { week: "2026-11-09", choice: "goal" as const, goal: 1, pence: 3_000 } };
  assert.equal(budgetView(covered, MONDAY).week.carry, 0);
  const kept = { ...over, checkin: { week: "2026-11-09", choice: "keep" as const, goal: null, pence: 3_000 } };
  assert.equal(budgetView(kept, MONDAY).week.carry, 3_000);
});
