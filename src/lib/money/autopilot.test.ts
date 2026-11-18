import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./autopilot.ts";
import type { BudgetData, Goal } from "./budget.ts";
import { alertText } from "./state.ts";

// Made-up money. Today is Monday 4 January 2027: the 31 December payday has been, and
// last week (from 28 December) had £150 fixed for it and £100 spent.
const goal = (o: Partial<Goal>): Goal => ({
  id: 1,
  name: "Emergency fund",
  kind: "saving",
  targetPence: 430_000,
  dueOn: null,
  repeatsYearly: false,
  held: "elsewhere",
  savedPence: 0,
  savedOn: "2026-12-01",
  aprBp: null,
  paymentPence: null,
  merchantKey: "example-saver",
  category: null,
  position: 1,
  status: "active",
  addedBy: "owner",
  movedPence: 0,
  spentPence: 0,
  ...o,
});
const data = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 60_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 10_000,
  income: [{ fromOn: "2026-12-31", pence: 228_000, grossYearPence: null }],
  weeklyFloorPence: 12_000,
  weekAmount: { of: "2026-12-28", pence: 15_000 },
  goals: [
    goal({}),
    goal({
      id: 2,
      name: "Christmas",
      kind: "sinking",
      targetPence: 20_000,
      dueOn: "2027-12-01",
      held: "account",
      merchantKey: null,
      position: 2,
    }),
  ],
  ...o,
});
const TODAY = "2027-01-04";
const fresh = { lastWeekClosed: "2026-12-21", lastPaydayDone: "2026-11-30" };

test("after payday and a new week: money set aside for the account's goal, last week's £50 to it too, and this week fixed", () => {
  const { apply } = decide(data(), fresh, [], TODAY);
  assert.equal(apply.payday_done, "2026-12-31");
  assert.equal(apply.closed_week, "2026-12-28");
  // Christmas: £200 over 11 months is £18.19 this payday, plus the £50 left of last week.
  assert.deepEqual(apply.set_aside, [{ goal: 2, pence: 1_819 + 5_000 }]);
  // (£600 − £68.19 set aside) over the 25 days to 29 January, in whole pounds.
  assert.deepEqual(apply.week_amount, { of: "2027-01-04", pence: 14_800 });
});

test("a planned transfer to the saver that hasn't all arrived 3 days after payday raises one alert", () => {
  const { alerts } = decide(data(), fresh, [{ goal: 1, on: "2027-01-01", pence: 45_000 }], TODAY);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].dedupe, "transfer-missing:1:2026-12-31");
  assert.equal(alerts[0].goal, 1);
  assert.ok(alerts[0].detail.pence > 0);
  assert.deepEqual(decide(data(), fresh, [], "2027-01-02").alerts, [], "not before 3 days have passed");
});

test("once done, nothing is done twice", () => {
  const { apply } = decide(
    data({ weekAmount: { of: "2027-01-04", pence: 14_800 } }),
    { lastWeekClosed: "2026-12-28", lastPaydayDone: "2026-12-31" },
    [],
    TODAY,
  );
  assert.deepEqual(apply, {});
});

test("without a floor the week is left alone, and before the first payday nothing is set aside", () => {
  const off = decide(data({ weeklyFloorPence: null }), fresh, [], TODAY).apply;
  assert.equal(off.week_amount, undefined);
  assert.equal(off.closed_week, undefined);
  assert.deepEqual(off.set_aside, [{ goal: 2, pence: 1_819 }], "payday still sets aside");
  const bridge = decide(data(), { lastWeekClosed: null, lastPaydayDone: null }, [], "2026-11-18").apply;
  assert.equal(bridge.payday_done, undefined);
  assert.equal(bridge.set_aside, undefined);
});

test("the alert says what has not arrived and how to make it automatic", () => {
  assert.equal(
    alertText({
      id: 1,
      kind: "transfer-missing",
      raisedAt: "",
      payment: null,
      detail: { name: "Emergency fund", pence: 15_000, payday: "2026-12-31" },
    }),
    "Emergency fund: £150.00 planned on payday (Thu 31 Dec) hasn't arrived yet. A standing order for the day after payday does it for you.",
  );
});

test("later checks measure against the moves shown on payday, not the plan worked out again", () => {
  const done = { lastWeekClosed: "2026-12-28", lastPaydayDone: "2026-12-31" };
  const shown = data({
    weekAmount: { of: "2027-01-04", pence: 14_800 },
    paydayTransfers: { payday: "2026-12-31", transfers: [{ goal: 1, name: "Emergency fund", pence: 45_000 }] },
  });
  assert.deepEqual(decide(shown, done, [{ goal: 1, on: "2027-01-01", pence: 45_000 }], TODAY).alerts, []);
  const short = decide(shown, done, [{ goal: 1, on: "2027-01-01", pence: 40_000 }], TODAY).alerts;
  assert.equal(short[0].detail.pence, 5_000);
  const first = decide(data(), fresh, [], TODAY).apply;
  assert.equal(first.payday_transfers?.payday, "2026-12-31", "the moves are kept on payday");
  assert.equal(first.payday_transfers?.transfers[0].goal, 1);
});
