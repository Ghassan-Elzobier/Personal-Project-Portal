import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, goalDates, shareOut, suggestGoals } from "./allocate.ts";
import { prompts } from "./prompts.ts";
import { billedCategories, budgetView, type BudgetData, type Goal, type Regular } from "./budget.ts";
import { forecast, whatIf } from "./forecast.ts";
import { billsToStore, foundBills, goalBillId, ongoingPlans, paidFor, withCost, withOngoing } from "./ongoing.ts";
import { dueUntil, occurrencesIn, type Bill } from "./recurring.ts";

// Made-up money. Today is Monday 4 January 2027; pay comes on the 15th, or the working
// day before: 15 Jan, 15 Feb, 15 Mar, 15 Apr, 14 May, 15 Jun...
const TODAY = "2027-01-04";

const bill = (o: Partial<Bill>): Bill => ({
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
  ...o,
});

const regular = (o: Partial<Regular> = {}): Regular => ({
  costPence: 10_000,
  cadence: "monthly",
  setupPence: null,
  replacesMerchantKey: null,
  replaceOverlap: false,
  startOn: null,
  weekday: null,
  estimated: false,
  billId: null,
  payments: [],
  ...o,
});

const goal = (o: Partial<Goal>): Goal => ({
  id: 1,
  name: "Example gym",
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
  ...o,
});

const cost = (o: Partial<Regular> = {}, g: Partial<Goal> = {}) => goal({ regular: regular(o), ...g });

const saving = (o: Partial<Goal>): Goal =>
  goal({ id: 9, name: "Example saver", kind: "saving", targetPence: 240_000, position: 1, ...o });

/**
 * Pay of £1,550 a month and rent of £1,000 on the 1st: £550 spare a month, with no
 * weekly amount, from a balance of £300.
 */
const budget = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 30_000,
  allowancePence: 0,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "day-15",
  firstPayday: null,
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [bill({})],
  income: [{ fromOn: "2027-01-01", pence: 155_000, grossYearPence: null }],
  weeklyFloorPence: 0,
  goals: [],
  ...o,
});

const plan = (data: BudgetData) => ongoingPlans(data, TODAY);

test("a pay step: no start before it, then its first payday when that cycle holds", () => {
  const data = budget({
    balancePence: 100_000,
    allowancePence: 12_000,
    weeklyFloorPence: 6_000,
    bufferPence: 20_000,
    bufferFrom: "2027-03-15",
    bills: [bill({ expectedPence: 60_000 })],
    income: [
      { fromOn: "2027-01-01", pence: 100_000, grossYearPence: null },
      { fromOn: "2027-03-01", pence: 200_000, grossYearPence: null },
    ],
    goals: [cost({ costPence: 30_000 })],
  });
  assert.equal(plan(data)[0].fitsFrom, "2027-03-15");
  assert.equal(plan(data)[0].failing, "keeps-up");

  // A big one-off in April breaks that cycle's cash: the next payday instead.
  const april = {
    ...data,
    planned: [{ name: "Example repair", pence: 180_000, dueOn: "2027-04-10", funding: "safe", weeks: 1 }],
  };
  assert.equal(plan(april)[0].fitsFrom, "2027-04-15");
});

test("the floor trap: it waits for the goal above to keep its pace, and never passes at the floor", () => {
  const data = budget({
    balancePence: 100_000,
    allowancePence: 15_000,
    weeklyFloorPence: 5_000,
    bills: [bill({ expectedPence: 80_000 })],
    income: [{ fromOn: "2027-01-01", pence: 200_000, grossYearPence: null }],
    goals: [saving({ position: 1 }), cost({ costPence: 40_000 }, { position: 2 })],
  });
  const p = plan(data)[0];
  // At the floor, the first cycle would hold: the bills, the cost and £50 a week.
  const first = allocate(withCost(data, data.goals![1], "2027-01-15", TODAY), "2027-01-15")!;
  assert.equal(first.short, false);
  assert.ok(first.weekly < 15_000, "the first cycle can't reach the target");
  assert.notEqual(p.fitsFrom, null);
  assert.ok(p.fitsFrom! > "2027-01-15", `waits: ${p.fitsFrom}`);
  // With the saving goal done, it fits from the next payday.
  const done = { ...data, goals: [saving({ position: 1, savedPence: 240_000 }), data.goals![1]] };
  assert.equal(plan(done)[0].fitsFrom, "2027-01-15");
  // Below the saving goal, it starts at once, and the saving goal slows.
  const below = { ...data, goals: [saving({ position: 3 }), data.goals![1]] };
  assert.equal(plan(below)[0].fitsFrom, "2027-01-15");
  assert.deepEqual(plan(below)[0].slows, ["Example saver"]);
});

test("a replaced bill ends from its first due day after the start, the fee lands on the start, and a found bill takes over", () => {
  const old = bill({
    id: 2,
    ident: "gym-old",
    merchantKey: "gym-old",
    name: "Old gym",
    category: null,
    expectedPence: 4_000,
    anchorOn: "2026-12-01",
    lastPaidOn: "2027-01-01",
  });
  const g = cost(
    { costPence: 12_000, setupPence: 10_000, replacesMerchantKey: "gym-old", startOn: "2027-02-15" },
    { merchantKey: "gym-new" },
  );
  const data = budget({ bills: [bill({}), old], goals: [g] });
  const out = withOngoing(data, TODAY);
  const ended = out.bills!.find((b) => b.merchantKey === "gym-old")!;
  assert.equal(ended.endsOn, "2027-03-01");
  assert.deepEqual(dueUntil(ended, TODAY, "2027-06-30"), ["2027-02-01"]);
  const made = out.bills!.find((b) => b.id === goalBillId(g))!;
  assert.equal(made.anchorOn, "2027-02-15");
  assert.equal(made.expectedPence, 12_000);
  assert.deepEqual(
    out.planned!.map((p) => [p.dueOn, p.pence]),
    [["2027-02-15", 10_000]],
  );
  assert.equal(plan(data)[0].monthlyPence, 8_000);
  assert.equal(plan(data)[0].startOn, "2027-02-15");

  // Money finds the new gym's bill: the made-up one stops, the old one stays ended.
  const found = bill({
    id: 3,
    ident: "gym-new",
    merchantKey: "gym-new",
    name: "New gym",
    category: null,
    expectedPence: 12_000,
    anchorOn: "2027-02-15",
  });
  const later = withOngoing({ ...data, bills: [bill({}), old, found] }, TODAY);
  assert.equal(
    later.bills!.some((b) => b.id < 0),
    false,
  );
  assert.equal(later.bills!.find((b) => b.merchantKey === "gym-old")!.endsOn, "2027-03-01");
  assert.deepEqual(billsToStore({ ...data, bills: [bill({}), old, found] }), [{ goal: 1, bill: 3 }]);
});

test("a weekly cost on monthly paydays counts every session in each cycle, not an average", () => {
  // £220 spare a month; £50 each Monday.
  const data = budget({
    income: [{ fromOn: "2027-01-01", pence: 122_000, grossYearPence: null }],
    goals: [cost({ costPence: 5_000, cadence: "weekly", weekday: 0 })],
  });
  const g = data.goals![0];
  const taken = withCost(data, g, "2027-01-15", TODAY);
  // 15 Jan to 15 Feb: four Mondays. 15 Mar to 15 Apr: five.
  const four = shareOut(taken, "2027-01-15", 122_000);
  const five = shareOut(taken, "2027-03-15", 122_000);
  assert.equal(four.commitments, 100_000 + 4 * 5_000);
  assert.equal(five.commitments, 100_000 + 5 * 5_000);
  assert.equal(four.short, false);
  assert.equal(five.short, true);
  assert.equal(plan(data)[0].fitsFrom, null);
});

test("goal order: a cost below a saving goal waits for it; swap two costs and their starts swap", () => {
  // £550 spare: a saving goal at £100 a month, then A at £300 and B at £200.
  const saver = saving({ targetPence: 120_000, position: 1 });
  const a = cost({ costPence: 30_000 }, { id: 2, name: "A", position: 2 });
  const b = cost({ costPence: 20_000 }, { id: 3, name: "B", position: 3 });
  const ab = plan(budget({ balancePence: 100_000, goals: [saver, a, b] }));
  assert.equal(ab.find((p) => p.name === "A")!.fitsFrom, "2027-01-15");
  const bAfter = ab.find((p) => p.name === "B")!.fitsFrom;
  assert.ok(bAfter && bAfter > "2027-01-15", `B waits: ${bAfter}`);

  const ba = plan(budget({ balancePence: 100_000, goals: [saver, { ...a, position: 3 }, { ...b, position: 2 }] }));
  assert.equal(ba.find((p) => p.name === "B")!.fitsFrom, "2027-01-15");
  const aAfter = ba.find((p) => p.name === "A")!.fitsFrom;
  assert.ok(aAfter && aAfter > "2027-01-15", `A waits: ${aAfter}`);
});

test("goal transfers count in the cash test: a saver elsewhere taking the surplus leaves no room for the fee", () => {
  const fund = (held: Goal["held"]) => saving({ targetPence: 5_000_000, held, position: 3 });
  const g = cost({ costPence: 10_000, setupPence: 15_000 }, { position: 2 });
  const data = (held: Goal["held"]) => budget({ bufferPence: 20_000, goals: [g, fund(held)] });
  assert.equal(plan(data("account"))[0].fitsFrom, "2027-01-15");
  const p = plan(data("elsewhere"))[0];
  assert.equal(p.fitsFrom, null);
  assert.equal(p.failing, "cash");
  assert.ok(p.cashPence! > 0);
  assert.deepEqual(plan(data("account"))[0].slows, ["Example saver"]);
});

test("a low point a hundred days on is caught by the year-long cash test", () => {
  const data = budget({
    planned: [{ name: "Example boiler", pence: 170_000, dueOn: "2027-04-14", funding: "safe", weeks: 1 }],
    goals: [cost({ costPence: 10_000 })],
  });
  // The usual 13-week forecast ends before it.
  assert.ok(forecast(data, TODAY)!.points.at(-1)!.day < "2027-04-14");
  const p = plan(data)[0];
  assert.equal(p.failing, "cash");
  assert.equal(p.fitsFrom, "2027-02-15");
});

test("the plan's answer and the recent pace's answer, both", () => {
  const groceries = {
    key: "groceries",
    name: "Groceries",
    kind: "groceries",
    budgetPence: null,
    paidMonth: 0,
    spentWeek: 0,
    spentLastWeek: 0,
    weeks: Array(8).fill(25_000),
  };
  const data = budget({
    balancePence: 100_000,
    allowancePence: 15_000,
    weeklyFloorPence: 15_000,
    categories: [groceries],
    income: [{ fromOn: "2027-01-01", pence: 200_000, grossYearPence: null }],
    goals: [cost({ costPence: 20_000 })],
  });
  const p = plan(data)[0];
  assert.equal(p.fitsFrom, "2027-01-15");
  assert.deepEqual(p.atPace, { fitsFrom: null });
  assert.equal(plan(budget({ goals: [cost({})] }))[0].atPace, null);
});

test("never within a year: the monthly gap and the highest price that fits", () => {
  const data = budget({
    income: [{ fromOn: "2027-01-01", pence: 122_000, grossYearPence: null }],
    goals: [cost({ costPence: 30_000 })],
  });
  const p = plan(data)[0];
  assert.equal(p.fitsFrom, null);
  assert.equal(p.failing, "keeps-up");
  assert.equal(p.maxPence, 22_000);
  assert.equal(p.gapMonthlyPence, 8_000);
  assert.equal(withOngoing(data, TODAY).bills!.length, 1, "a cost that doesn't fit counts nowhere");
});

test("a setup fee can move the start to the next payday", () => {
  const data = (setupPence: number | null) =>
    budget({ bufferPence: 20_000, goals: [cost({ costPence: 10_000, setupPence })] });
  assert.equal(plan(data(null))[0].fitsFrom, "2027-01-15");
  assert.equal(plan(data(70_000))[0].fitsFrom, "2027-02-15");
});

test("an owner's start is checked, and kept whether or not it holds", () => {
  const data = (startOn: string) =>
    budget({ bufferPence: 20_000, goals: [cost({ costPence: 10_000, setupPence: 70_000, startOn })] });
  assert.equal(plan(data("2027-01-15"))[0].startHolds, false);
  assert.equal(plan(data("2027-02-15"))[0].startHolds, true);
  assert.equal(withOngoing(data("2027-01-15"), TODAY).bills!.find((b) => b.id < 0)!.anchorOn, "2027-01-15");
});

test("a made-up bill never stops a bills category counting its month, and isn't a bill Money found", () => {
  const gym = {
    key: "gym",
    name: "Gym",
    kind: "bills",
    budgetPence: 3_000,
    paidMonth: 0,
    spentWeek: 0,
    spentLastWeek: 0,
  };
  const data = budget({ categories: [gym], goals: [cost({ startOn: "2027-01-15" })] });
  const out = withOngoing(data, TODAY);
  assert.equal(out.bills!.length, 2);
  assert.equal(billedCategories(out.bills).has("gym"), false);
  assert.deepEqual(
    foundBills(out.bills).map((b) => b.id),
    [1],
  );
});

test("regular costs stay out of the goal waterfall and its dates", () => {
  const data = budget({ goals: [saving({}), cost({ startOn: "2027-01-15" }, { id: 2, position: 2 })] });
  const out = withOngoing(data, TODAY);
  const a = allocate(out, "2027-01-15")!;
  assert.deepEqual(
    a.shares.map((s) => s.id),
    [9],
  );
  assert.equal(a.commitments, 100_000 + 10_000);
  assert.deepEqual([...goalDates(out, "2027-01-15").keys()], [9]);
  assert.equal(budgetView(out, TODAY).held, 0);
});

test("payments that look like it set when it was last paid", () => {
  const r = regular({
    startOn: "2027-01-01",
    payments: [
      { on: "2027-01-02", pence: 10_000, merchant: "1" },
      { on: "2027-02-02", pence: 10_500, merchant: "1" },
      { on: "2027-01-20", pence: 9_500, merchant: "2" },
      { on: "2027-01-24", pence: 9_500, merchant: "2" },
    ],
  });
  assert.deepEqual(paidFor(r), { merchant: "1", last: "2027-02-02" });
  const out = withOngoing(budget({ goals: [goal({ regular: r })] }), "2027-02-10");
  assert.equal(out.bills!.find((b) => b.id < 0)!.lastPaidOn, "2027-02-02");
  assert.equal(plan(budget({ goals: [goal({ regular: r })] }))[0].paid, true);
});

test("a bill that ends falls due no more, in the forecast and the pay cycle", () => {
  const b = bill({ endsOn: "2027-03-01" });
  assert.deepEqual(occurrencesIn(b, "2027-01-15", "2027-04-30"), ["2027-02-01"]);
  assert.deepEqual(dueUntil(b, TODAY, "2027-04-30"), ["2027-02-01"]);
});

test("a what-if can end a bill", () => {
  const data = budget({ balancePence: 100_000 });
  const w = whatIf(data, TODAY, { ends: [{ merchantKey: "example-lettings", from: "2027-02-15" }] })!;
  assert.equal(w.endChange, 200_000);
});

test("Money's suggestions and reminders come from the bills it found, never a regular cost's made-up bill", () => {
  const out = withOngoing(budget({ bills: [], goals: [cost({ cadence: "yearly", startOn: "2027-01-15" })] }), TODAY);
  assert.equal(out.bills!.length, 1);
  assert.deepEqual(suggestGoals(out, TODAY), []);
  assert.deepEqual(prompts(out, budgetView(out, "2027-01-14"), null, [], "2027-01-14"), []);
});
