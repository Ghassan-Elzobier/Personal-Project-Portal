import { test } from "node:test";
import assert from "node:assert/strict";
import { floorOutlook, forecast, type ForecastData } from "./forecast.ts";
import type { Bill } from "./recurring.ts";

// Made-up money, today Wednesday 18 November 2026: £1,000 in the bank, rent of £500 on
// the 8th, pay of £1,306 from 31 December, a plan of £150 a week and a floor of £80.
const TODAY = "2026-11-18";
const rent: Bill = {
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
};
const data = (o: Partial<ForecastData> = {}): ForecastData => ({
  balancePence: 100_000,
  allowancePence: 15_000,
  weeklyFloorPence: 8_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  planned: [],
  bills: [rent],
  income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }],
  lastPay: null,
  ...o,
});

test("the best case spends the floor each week, so it ends higher than the plan by the weeks' difference", () => {
  const plan = forecast(data(), TODAY)!;
  const best = floorOutlook(data(), TODAY)!;
  assert.equal(best.floor, 8_000);
  assert.equal(best.plan, 15_000);
  assert.equal(best.points.length, plan.points.length);
  const end = (ps: { pence: number }[]) => ps[ps.length - 1].pence;
  // 13 weeks at £70 a week less: about £910 more by the end (the first week is part spent).
  const more = end(best.points) - end(plan.points);
  assert.ok(more > 80_000 && more <= 91_000, `£${more / 100} more`);
  assert.ok(best.lowest.pence >= plan.lowest.pence);
});

test("no best case without a floor, with a floor at or above the plan, or without a balance", () => {
  assert.equal(floorOutlook(data({ weeklyFloorPence: null }), TODAY), null);
  assert.equal(floorOutlook(data({ weeklyFloorPence: 15_000 }), TODAY), null);
  assert.equal(floorOutlook(data({ balancePence: null }), TODAY), null);
});
