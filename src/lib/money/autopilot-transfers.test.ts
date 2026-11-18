import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./autopilot.ts";
import type { BudgetData, Goal } from "./budget.ts";

// The missing-transfer check measures against the moves shown on payday. Made-up money:
// today is Monday 4 January 2027, after the 31 December payday.
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
  unsortedLastWeek: 0,
  income: [{ fromOn: "2026-12-31", pence: 228_000, grossYearPence: null }],
  weeklyFloorPence: 12_000,
  weekAmount: { of: "2027-01-04", pence: 14_800 },
  goals: [goal({})],
  ...o,
});
const TODAY = "2027-01-04";
const done = { lastWeekClosed: "2026-12-28", lastPaydayDone: "2026-12-31" };
const shown = { payday: "2026-12-31", transfers: [{ goal: 1, name: "Emergency fund", pence: 45_000 }] };

test("the moves shown on payday that arrived in full raise nothing, even though the plan worked out again asks more", () => {
  assert.deepEqual(
    decide(data({ paydayTransfers: shown }), done, [{ goal: 1, on: "2027-01-01", pence: 45_000 }], TODAY).alerts,
    [],
  );
});

test("a move that arrived short raises an alert for what's missing", () => {
  const [a] = decide(
    data({ paydayTransfers: shown }),
    done,
    [{ goal: 1, on: "2027-01-01", pence: 40_000 }],
    TODAY,
  ).alerts;
  assert.equal(a.detail.pence, 5_000);
  assert.equal(a.dedupe, "transfer-missing:1:2026-12-31");
});

test("payday keeps its moves, and with none kept (an earlier payday) nothing is checked", () => {
  const first = decide(
    data({ weekAmount: null }),
    { lastWeekClosed: "2026-12-21", lastPaydayDone: "2026-11-30" },
    [],
    TODAY,
  ).apply;
  assert.equal(first.payday_transfers?.payday, "2026-12-31");
  assert.equal(first.payday_transfers?.transfers[0].goal, 1);
  assert.deepEqual(decide(data(), done, [], TODAY).alerts, []);
});
