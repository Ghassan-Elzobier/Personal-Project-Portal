import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate } from "./allocate.ts";
import type { BudgetData, Goal } from "./budget.ts";
import type { Bill } from "./recurring.ts";

// A debt on a monthly payment keeps that pace: a pay rise or what's left of a payday
// doesn't speed it up. The money goes on to the next goal, or stays in the account.
// A debt with no monthly payment still takes the extra.
//
// Made-up money. Pay is £2,280 a month, £2,680 from the 29 January payday; rent is £500.
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
  name: "Example loan",
  kind: "debt",
  targetPence: null,
  dueOn: null,
  repeatsYearly: false,
  held: "elsewhere",
  savedPence: 90_000,
  savedOn: "2026-11-18",
  aprBp: null,
  paymentPence: 10_000,
  merchantKey: null,
  category: null,
  position: 1,
  status: "active",
  addedBy: "owner",
  movedPence: 0,
  spentPence: 0,
  ...o,
});
const fund = goal({
  id: 2,
  name: "Emergency fund",
  kind: "saving",
  targetPence: 430_000,
  savedPence: 0,
  paymentPence: null,
  position: 2,
});
const FROM = "2026-12-31";
const RISE = "2027-01-29";
const plan = (goals: Goal[], o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 100_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: FROM,
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [bill({})],
  income: [
    { fromOn: "2026-11-01", pence: 228_000, grossYearPence: null },
    { fromOn: RISE, pence: 268_000, grossYearPence: null },
  ],
  weeklyFloorPence: 12_000,
  raiseGoalShareBp: 10_000,
  raiseSince: FROM,
  goals,
  ...o,
});
const share = (data: BudgetData, day: string, id: number) => allocate(data, day)!.shares.find((s) => s.id === id)!;

test("a debt on a monthly payment takes none of a pay rise: its share goes on to the goal after it", () => {
  const loan = share(plan([goal({}), fund]), RISE, 1);
  const saver = share(plan([goal({}), fund]), RISE, 2);
  assert.equal(loan.pence, 0);
  assert.ok(saver.pence > saver.need, "the fund gets the rise as well as its pace");
  assert.ok(share(plan([goal({ paymentPence: null }), fund]), RISE, 1).pence > 0, "a debt with no payment takes it");
});

test("nor what's left once the weekly amount is at its target: with no goal after it, that stays in the account", () => {
  const flat = { income: [{ fromOn: "2026-11-01", pence: 228_000, grossYearPence: null }] };
  const a = allocate(plan([goal({})], flat), FROM)!;
  assert.equal(a.shares[0].pence, 0);
  assert.equal(a.weekly, 16_000, "the weekly amount is at its target");
  // The weekly amount raised from the £120 floor to the £160 target, for the 29 days to 29 January.
  assert.equal(a.surplus, a.pay - a.commitments - a.floor - 16_571, "the rest is left in the account");
  const open = allocate(plan([goal({ paymentPence: null })], flat), FROM)!;
  assert.equal(open.shares[0].pence, 90_000, "a debt with no payment takes what's left, up to what's owed");
  assert.equal(open.surplus, open.pay - open.commitments - open.floor - 16_571 - 90_000);
});

test("so it clears at its payment, with a rise or without one", () => {
  // £900 at £100 a month: nine payments, the last in August.
  assert.equal(share(plan([goal({}), fund]), FROM, 1).finish, "2027-08");
  assert.equal(share(plan([goal({}), fund], { raiseGoalShareBp: null, raiseSince: null }), FROM, 1).finish, "2027-08");
  assert.equal(
    share(plan([goal({}), fund], { income: [{ fromOn: "2026-11-01", pence: 228_000, grossYearPence: null }] }), FROM, 1)
      .finish,
    "2027-08",
  );
});
