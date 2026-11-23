import { test } from "node:test";
import assert from "node:assert/strict";
import { forecast, keepsAbove, paceOutlook, recentPace, type ForecastData } from "./forecast.ts";

// The forecast at your recent pace, beside the plan's. Made-up money, today Wednesday
// 18 November 2026; payday the last working day, from 31 December.
const TODAY = "2026-11-18";
const data = (o: Partial<ForecastData> = {}): ForecastData => ({
  balancePence: 100_000,
  allowancePence: 0,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  planned: [],
  bills: [],
  income: [],
  lastPay: null,
  ...o,
});
const on = (f: ReturnType<typeof forecast>, day: string) => f!.points.find((p) => p.day === day)!.pence;

// Made-up weeks of spending, oldest first: nothing for two weeks, then six weeks of groceries and a little unsorted.
const groceries = (weeks: number[]) => ({
  key: "groceries",
  name: "Groceries",
  kind: "groceries",
  budgetPence: null,
  paidMonth: 0,
  spentWeek: 0,
  spentLastWeek: 0,
  weeks,
});
const rentWeeks = { ...groceries([50_000, 0, 0, 0, 50_000, 0, 0, 0]), key: "rent", name: "Rent", kind: "bills" };
const paced = (o: Partial<ForecastData> = {}) =>
  data({
    bills: [],
    income: [],
    allowancePence: 14_000,
    bufferPence: 20_000,
    categories: [groceries([0, 0, 15_000, 20_000, 18_000, 25_000, 22_000, 19_000]), rentWeeks],
    unsortedWeeks: [0, 0, 1_000, 0, 2_000, 0, 0, 1_000],
    ...o,
  });

test("the recent pace is the median of the weekly flexible and unsorted totals, from the first week with any", () => {
  // Weeks of £160, £200, £200, £250, £220 and £200: the bills category and the two empty weeks don't count.
  assert.equal(recentPace(paced()), 20_000);
  // One spike can't drag it.
  assert.equal(
    recentPace(paced({ categories: [groceries([0, 0, 15_000, 20_000, 18_000, 250_000, 22_000, 19_000])] })),
    20_000,
  );
  // An empty week after the first counts as a week.
  assert.equal(
    recentPace(paced({ unsortedWeeks: [], categories: [groceries([0, 0, 0, 0, 9_000, 0, 7_000, 8_000])] })),
    7_500,
  );
});

test("with fewer than 4 weeks of spending history there is no pace, and no pace outlook", () => {
  const short = paced({ unsortedWeeks: [], categories: [groceries([0, 0, 0, 0, 0, 20_000, 22_000, 19_000])] });
  assert.equal(recentPace(short), null);
  assert.equal(paceOutlook(short, TODAY), null);
  assert.equal(recentPace(paced({ unsortedWeeks: undefined, categories: [] })), null);
});

test("spending above the plan: the pace forecast's payday balance and lowest point are below the plan's", () => {
  const d = paced({ balancePence: 200_000, income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }] });
  const plan = forecast(d, TODAY)!;
  const pace = paceOutlook(d, TODAY)!;
  assert.equal(pace.pace, 20_000);
  assert.equal(pace.plan, 14_000);
  assert.equal(pace.points.length, plan.points.length);
  assert.equal(pace.payday!.day, "2026-12-31");
  assert.ok(pace.payday!.pence < on(plan, "2026-12-31"));
  assert.ok(pace.lowest.pence < plan.lowest.pence);
});

const holdsTo = (d: ForecastData, weekly: number, payday: string) =>
  forecast({ ...d, allowancePence: weekly }, TODAY)!.points.every((p) => p.day >= payday || p.pence >= d.bufferPence);

test("keepsAbove: the most a week that stays above the buffer to payday, and a pound more doesn't", () => {
  const d = paced({ balancePence: 90_000 });
  assert.equal(holdsTo(d, 14_000, "2026-12-31"), false, "the plan goes under the buffer");
  const w = keepsAbove(d, TODAY)!;
  assert.ok(w > 0 && w < 14_000 && w % 100 === 0);
  assert.equal(holdsTo(d, w, "2026-12-31"), true);
  assert.equal(holdsTo(d, w + 100, "2026-12-31"), false);
  // On the pace line the plan's amount still looks short.
  assert.equal(paceOutlook(d, TODAY)!.shortBeforePayday, true);
});

test("keepsAbove is null when the plan already stays above the buffer, or when nothing would", () => {
  assert.equal(keepsAbove(paced({ balancePence: 200_000 }), TODAY), null);
  assert.equal(keepsAbove(paced({ balancePence: 10_000 }), TODAY), null);
  assert.equal(keepsAbove(paced({ balancePence: null }), TODAY), null);
});
