import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, withDebtEnds } from "./allocate.ts";
import type { BudgetData, Goal, Regular } from "./budget.ts";
import { forecast } from "./forecast.ts";
import { ongoingPlans, withOngoing } from "./ongoing.ts";
import type { Bill } from "./recurring.ts";

// A debt's bill ends once the debt is paid off: none of it falls due after the payment
// that clears what's owed, so the forecast, the pay cycle and the regular-cost tests
// stop counting a payment that is no longer owed.
//
// Made-up money. Today is Wednesday 25 November 2026; pay comes on the last working day,
// from 31 December. Rent is £500 on the 8th; the lender takes £100 on the 1st.
const TODAY = "2026-11-25";
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
const lender = (o: Partial<Bill> = {}) =>
  bill({
    id: 2,
    ident: "example-lender",
    merchantKey: "example-lender",
    name: "Example Lender",
    anchorOn: "2026-11-01",
    expectedPence: 10_000,
    category: "debts",
    lastPaidOn: "2026-11-02",
    lastPence: 10_000,
    ...o,
  });
const goal = (o: Partial<Goal>): Goal => ({
  id: 1,
  name: "Example Lender",
  kind: "debt",
  targetPence: null,
  dueOn: null,
  repeatsYearly: false,
  held: "elsewhere",
  savedPence: 10_000,
  savedOn: "2026-11-20",
  aprBp: null,
  paymentPence: 10_000,
  merchantKey: "example-lender",
  category: null,
  position: 1,
  status: "active",
  addedBy: "owner",
  movedPence: 0,
  spentPence: 0,
  ...o,
});
const budget = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 100_000,
  allowancePence: 0,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [bill({}), lender()],
  income: [{ fromOn: "2026-12-01", pence: 135_000, grossYearPence: null }],
  weeklyFloorPence: 0,
  goals: [goal({})],
  ...o,
});
const endsOn = (data: BudgetData) => withDebtEnds(data, TODAY).bills!.find((b) => b.id === 2)!.endsOn ?? null;

test("a debt's bill stops after the payment that clears it, in the forecast and the pay cycle", () => {
  const data = budget();
  // £100 owed and £100 on 1 December: that payment clears it.
  assert.equal(endsOn(data), "2027-01-01");
  const lenderDays = (d: BudgetData) =>
    forecast(d, TODAY, 91)!
      .events.filter((e) => e.name === "Example Lender")
      .map((e) => e.day);
  assert.deepEqual(lenderDays(withOngoing(data, TODAY)), ["2026-12-01"]);
  assert.deepEqual(lenderDays(data), ["2026-12-01", "2027-01-01", "2027-02-01"], "before, it went on");
  assert.equal(allocate(withOngoing(data, TODAY), "2026-12-31")!.commitments, 50_000, "rent alone from 31 December");
});

test("a longer debt counts whole payments at the bill's amount, with its interest", () => {
  assert.equal(
    endsOn(
      budget({ goals: [goal({ savedPence: 94_999, paymentPence: 5_000 })], bills: [lender({ expectedPence: 5_000 })] }),
    ),
    "2028-07-01",
    "19 payments from 1 December",
  );
  assert.equal(
    endsOn(budget({ goals: [goal({ savedPence: 90_000, aprBp: 1_990 })] })),
    "2027-10-01",
    "ten payments, not nine",
  );
  assert.equal(
    endsOn(budget({ goals: [goal({ savedPence: 90_000, aprBp: 1_990 })], bills: [lender({ expectedPence: 1_000 })] })),
    null,
    "a payment the interest beats never ends it",
  );
});

test("a debt already paid, or marked done, stops at once; one not followed, or paused, keeps its bill", () => {
  assert.equal(endsOn(budget({ goals: [goal({ movedPence: 10_000 })] })), "2026-12-01");
  assert.equal(endsOn(budget({ goals: [goal({ status: "done" })] })), "2026-12-01");
  assert.equal(endsOn(budget({ goals: [goal({ merchantKey: null })] })), null);
  assert.equal(endsOn(budget({ goals: [goal({ status: "paused" })] })), null);
  // An end that comes sooner already stays.
  assert.equal(
    endsOn(budget({ bills: [bill({}), lender({ endsOn: "2026-12-01" })], goals: [goal({ savedPence: 50_000 })] })),
    "2026-12-01",
  );
});

test("a regular cost that only fits once the debt is paid fits from then", () => {
  // Paid on the 15th, £1,350 less £500 rent leaves £850: an £800 cost fits once the lender's £100 stops.
  const regular: Regular = {
    costPence: 80_000,
    cadence: "monthly",
    setupPence: null,
    replacesMerchantKey: null,
    replaceOverlap: false,
    startOn: null,
    weekday: null,
    estimated: false,
    billId: null,
    payments: [],
  };
  const cost = goal({
    id: 2,
    name: "Example class",
    kind: "recurring",
    merchantKey: null,
    paymentPence: null,
    position: 2,
    regular,
  });
  const monthly = { paydayRule: "day-15", firstPayday: null };
  const data = budget({ ...monthly, goals: [goal({ savedPence: 20_000 }), cost] });
  assert.equal(ongoingPlans(data, TODAY)[0].fitsFrom, "2027-01-15", "two payments, on 1 December and 1 January");
  const kept = budget({ ...monthly, goals: [cost] });
  assert.equal(ongoingPlans(kept, TODAY)[0].fitsFrom, null, "with no debt to follow, the lender's bill goes on");
});
