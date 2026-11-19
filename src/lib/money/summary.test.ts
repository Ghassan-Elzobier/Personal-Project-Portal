import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./autopilot.ts";
import { budgetView, type BudgetData } from "./budget.ts";
import { forecast } from "./forecast.ts";
import { weekSummary } from "./summary.ts";

// Made-up money. Today is Wednesday 18 November; last week began Monday 9 November.
const TODAY = "2026-11-18";
const data = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 100_000,
  allowancePence: 16_000,
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
      spentLastWeek: 4_500,
      weeks: [2_000, 2_000, 1_800, 2_200, 2_000, 2_100, 1_900, 4_500],
    },
    {
      key: "groceries",
      name: "Groceries",
      kind: "groceries",
      budgetPence: null,
      paidMonth: 0,
      spentWeek: 0,
      spentLastWeek: 6_800,
      weeks: [7_000, 7_100, 6_900, 7_000, 7_200, 7_000, 6_900, 6_800],
    },
  ],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  ...o,
});
const summary = (d: BudgetData) => weekSummary(d, budgetView(d, TODAY), forecast(d, TODAY), TODAY);

test("last week against its amount, and only what was well off your usual week", () => {
  const s = summary(data());
  assert.equal(s.week, "2026-11-09");
  assert.equal(s.amount, 16_000);
  assert.equal(s.spent, 11_300);
  assert.deepEqual(s.unusual, [{ name: "Eating out", spent: 4_500, usual: 2_000 }]);
});

test("the week the engine closed: its fixed amount and what went to which goal", () => {
  const s = summary(
    data({
      weeklyFloorPence: 12_000,
      lastWeek: {
        week: "2026-11-09",
        amountPence: 15_000,
        spentPence: 12_000,
        swept: [{ goal: 2, name: "Christmas", pence: 3_000 }],
      },
    }),
  );
  assert.equal(s.amount, 15_000);
  assert.equal(s.spent, 12_000);
  assert.deepEqual(s.swept, [{ name: "Christmas", pence: 3_000 }]);
});

test("the engine records the week it closes, with what it swept", () => {
  const d = data({
    weeklyFloorPence: 12_000,
    weekAmount: { of: "2026-11-09", pence: 15_000 },
    goals: [
      {
        id: 2,
        name: "Christmas",
        kind: "sinking",
        targetPence: 20_000,
        dueOn: "2026-12-20",
        repeatsYearly: true,
        held: "account",
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
  const { apply } = decide(d, { lastWeekClosed: "2026-11-02", lastPaydayDone: null }, [], TODAY);
  assert.deepEqual(apply.last_week, {
    week: "2026-11-09",
    amount_pence: 15_000,
    spent_pence: 11_300,
    swept: [{ goal: 2, name: "Christmas", pence: 3_700 }],
  });
});

test("the next 7 days come from the forecast's moves", () => {
  const s = summary(
    data({ planned: [{ name: "Example repair", pence: 6_000, dueOn: "2026-11-21", funding: "safe", weeks: 1 }] }),
  );
  assert.deepEqual(s.next7, [{ day: "2026-11-21", name: "Example repair", pence: -6_000 }]);
});
