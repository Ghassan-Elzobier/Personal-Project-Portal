import { test } from "node:test";
import assert from "node:assert/strict";
import type { Goal } from "./budget.ts";
import { FORECAST_DAYS, forecast, keepsAbove, paceOutlook, type ForecastData } from "./forecast.ts";
import { paydayMoves } from "./moves.ts";
import type { Bill } from "./recurring.ts";

// What each payday moves to savers and lenders, and the forecast taking it off. Made-up
// money, today Wednesday 18 November 2026: £1,000 in the bank, rent of £500 on the 8th,
// pay of £1,306 from 31 December (then 29 January), a plan of £150 a week.
const TODAY = "2026-11-18";
const bill = (o: Partial<Bill> = {}): Bill => ({
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
  id: 7,
  name: "Holiday",
  kind: "saving",
  targetPence: 20_000,
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
const data = (o: Partial<ForecastData> = {}): ForecastData => ({
  balancePence: 100_000,
  allowancePence: 15_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  planned: [],
  bills: [bill()],
  income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }],
  lastPay: null,
  ...o,
});
const run = (d: ForecastData) => forecast(d, TODAY, FORECAST_DAYS, paydayMoves(d, TODAY))!;

test("a goal held elsewhere takes its share off the forecast on the payday, named after it", () => {
  // £200 to go, at £200 a month: the next payday's share-out gives it £200, then it's done.
  const saver = { ...goal({ held: "elsewhere", paymentPence: 20_000 }) };
  const away = data({ goals: [saver] });
  const kept = data({ goals: [{ ...saver, held: "account" }] });
  assert.deepEqual(paydayMoves(away, TODAY), [{ day: "2026-12-31", name: "Holiday", pence: 20_000 }]);
  assert.deepEqual(paydayMoves(kept, TODAY), []);

  const a = run(away);
  const k = run(kept);
  a.points.forEach((p, i) =>
    assert.equal(k.points[i].pence - p.pence, p.day >= "2026-12-31" ? 20_000 : 0, `on '${p.day}'`),
  );
  assert.ok(a.events.some((e) => e.day === "2026-12-31" && e.name === "Holiday" && e.pence === -20_000));
  assert.equal(a.lowest.pence <= k.lowest.pence, true);
});

test("a debt's payment with no bill found comes off each payday, and once when its bill is found", () => {
  // £3,000 owed at £100 a month; the weekly amount takes what's left of each pay, so no extra goes to it.
  const loan = goal({
    name: "Car loan",
    kind: "debt",
    targetPence: 300_000,
    savedPence: 300_000,
    paymentPence: 10_000,
    merchantKey: "example-finance",
  });
  const unbilled = data({ allowancePence: 100_000, goals: [loan] });
  const moves = paydayMoves(unbilled, TODAY);
  // The share-out counts the payment over each cycle's days: 29 then 28 days.
  assert.deepEqual(moves, [
    { day: "2026-12-31", name: "Car loan", pence: Math.round((10_000 * 29) / 30.4) },
    { day: "2027-01-29", name: "Car loan", pence: Math.round((10_000 * 28) / 30.4) },
  ]);
  const without = forecast(data({ allowancePence: 100_000 }), TODAY)!;
  const end = (f: { points: { pence: number }[] }) => f.points[f.points.length - 1].pence;
  assert.equal(end(without) - end(run(unbilled)), moves[0].pence + moves[1].pence);

  // The lender's bill found: it goes out as the bill, and not again as a move.
  const lender = bill({
    id: 2,
    ident: "example-finance",
    merchantKey: "example-finance",
    name: "Car loan",
    expectedPence: 10_000,
    anchorOn: "2026-11-20",
    category: "debts",
  });
  const billed = data({ allowancePence: 100_000, bills: [bill(), lender], goals: [loan] });
  assert.deepEqual(paydayMoves(billed, TODAY), []);
  assert.deepEqual(
    run(billed).points,
    forecast(data({ allowancePence: 100_000, bills: [bill(), lender] }), TODAY)!.points,
  );
});

test("a saver whose standing order is found as a bill isn't taken off twice", () => {
  const order = bill({
    id: 3,
    ident: "example-saver",
    merchantKey: "example-saver",
    name: "To saver",
    expectedPence: 20_000,
  });
  const saver = goal({ paymentPence: 20_000, merchantKey: "example-saver" });
  assert.deepEqual(paydayMoves(data({ bills: [bill(), order], goals: [saver] }), TODAY), []);
});

test("the pace line and the weekly amount that keeps above the buffer count the moves", () => {
  const weeks = [16_000, 17_000, 18_000, 16_500, 17_500, 16_000, 18_000, 17_000];
  const saver = goal({ targetPence: 60_000, paymentPence: 60_000 });
  const d = data({
    bufferPence: 10_000,
    categories: [
      {
        key: "groceries",
        name: "Groceries",
        kind: "groceries",
        budgetPence: null,
        paidMonth: 0,
        spentWeek: 0,
        spentLastWeek: 0,
        weeks,
      },
    ],
    goals: [saver],
  });
  const moves = paydayMoves(d, TODAY);
  const plain = paceOutlook(d, TODAY)!;
  const moved = paceOutlook(d, TODAY, moves)!;
  assert.equal(plain.points.at(-1)!.pence - moved.points.at(-1)!.pence, 60_000);
  // Moves come on payday, so the weeks before it hold the same either way.
  assert.equal(keepsAbove(d, TODAY, moves), keepsAbove(d, TODAY));
});
