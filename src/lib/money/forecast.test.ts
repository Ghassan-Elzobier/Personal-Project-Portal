import { test } from "node:test";
import assert from "node:assert/strict";
import { forecast, payOn, spotPay, whatIf, type ForecastData } from "./forecast.ts";
import type { Bill } from "./recurring.ts";

// Made-up money, today Wednesday 18 November 2026; payday the last working day, from 31 December.
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
  allowancePence: 0,
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
const on = (f: ReturnType<typeof forecast>, day: string) => f!.points.find((p) => p.day === day)!.pence;

test("bills come out on their days and pay comes in on paydays, with the lowest point and when", () => {
  const f = forecast(data(), TODAY)!;
  assert.equal(f.points.length, 91);
  assert.equal(on(f, "2026-12-07"), 100_000);
  assert.equal(on(f, "2026-12-08"), 50_000);
  assert.equal(on(f, "2026-12-31"), 180_600);
  assert.equal(on(f, "2027-01-29"), 130_600 + 130_600 + 50_000 - 50_000);
  assert.deepEqual(f.lowest, { day: "2026-12-08", pence: 50_000 });
  assert.deepEqual(
    f.paydays.map((p) => p.day),
    ["2026-12-31", "2027-01-29"],
  );
  assert.deepEqual(f.events.slice(0, 2), [
    { day: "2026-12-08", name: "Rent", pence: -50_000 },
    { day: "2026-12-31", name: "Pay", pence: 130_600 },
  ]);
});

test("the weekly amount is spent through the week, what's left this week over the days left, and Monday's checkpoint is Sunday's end", () => {
  const f = forecast(data({ bills: [], allowancePence: 14_000 }), TODAY)!;
  // Wednesday to Sunday: £140 over 5 days, then £20 a day.
  assert.equal(on(f, "2026-11-22"), 86_000);
  assert.equal(on(f, "2026-11-29"), 72_000);
  assert.deepEqual(f.checkpoints.slice(0, 2), [
    { day: "2026-11-23", pence: 86_000 },
    { day: "2026-11-30", pence: 72_000 },
  ]);
});

test("a payday on a bank holiday comes the working day before", () => {
  const f = forecast(data({ paydayRule: "day-25", firstPayday: null }), "2026-12-01")!;
  assert.equal(f.paydays[0].day, "2026-12-24");
});

test("pay steps change the pay from their day, and a real pay replaces the estimate until a later step", () => {
  const steps = [
    { fromOn: "2026-12-31", pence: 130_600, grossYearPence: null },
    { fromOn: "2027-01-29", pence: 228_000, grossYearPence: null },
  ];
  assert.equal(payOn("2026-12-31", steps, null), 130_600);
  assert.equal(payOn("2027-02-26", steps, null), 228_000);
  const paid = { day: "2026-12-31", pence: 131_000 };
  assert.equal(payOn("2027-01-29", steps.slice(0, 1), paid), 131_000);
  assert.equal(payOn("2027-01-29", steps, paid), 228_000);
  assert.equal(payOn("2026-11-30", [], null), 0);
});

test("a purchase spread over 3 weeks goes out on its day, and the next 3 weeks have its share less to spend", () => {
  const f = forecast(
    data({
      bills: [],
      allowancePence: 14_000,
      planned: [{ name: "Bike repair", pence: 6_000, dueOn: "2026-11-23", funding: "spread", weeks: 3 }],
    }),
    TODAY,
  )!;
  assert.equal(on(f, "2026-11-29"), 86_000 - 6_000 - 12_000);
  assert.equal(on(f, "2026-12-13") - on(f, "2026-12-20"), 14_000);
});

test("days under the buffer count only once the buffer starts", () => {
  const f = forecast(
    data({
      bills: [],
      income: [],
      balancePence: 150_000,
      allowancePence: 14_000,
      bufferPence: 50_000,
      bufferFrom: "2027-01-29",
    }),
    TODAY,
  )!;
  assert.ok(on(f, "2027-01-10") < 50_000);
  assert.equal(f.underBuffer[0], "2027-01-29");
});

test("what if: a bigger pay, spending less a week, a new monthly cost and a one-off", () => {
  const pay = whatIf(data(), TODAY, { payPence: 228_000 })!;
  assert.equal(pay.endChange, 2 * (228_000 - 130_600));
  // £1,948 over the 91 days is £650.76 a month.
  assert.equal(pay.perMonth, 65_076);

  const less = whatIf(data({ allowancePence: 14_000 }), TODAY, { weeklyChangePence: -2_500 })!;
  assert.ok(Math.abs(less.endChange - 33_214) <= 1);

  const bill = whatIf(data(), TODAY, {
    bills: [{ name: "Bus pass", pence: 10_000, cadence: "monthly", on: "2026-12-01" }],
  })!;
  assert.equal(bill.endChange, -30_000);

  const oneOff = whatIf(data(), TODAY, { oneOffs: [{ name: "Bike", pence: 20_000, on: "2026-12-05" }] })!;
  assert.equal(oneOff.lowestChange, -20_000);
  assert.deepEqual(oneOff.after.lowest, { day: "2026-12-08", pence: 30_000 });
});

test("the engine spots a pay: the largest money in within 3 days of a payday, at least half the pay expected", () => {
  const plan = {
    paydayRule: "last-working-day",
    firstPayday: "2026-12-31",
    income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }],
  };
  const incoming = [
    { id: 1, madeOn: "2026-12-31", pence: 2_000 },
    { id: 2, madeOn: "2026-12-31", pence: 130_550 },
    { id: 3, madeOn: "2026-12-20", pence: 150_000 },
  ];
  assert.equal(spotPay(incoming, plan, "2027-01-02"), 2);
  assert.equal(spotPay(incoming.slice(0, 1), plan, "2027-01-02"), null, "a refund isn't pay");
  assert.equal(spotPay(incoming, { ...plan, income: [] }, "2027-01-02"), null, "nothing without a plan");
});

test("no balance, no forecast", () => {
  assert.equal(forecast(data({ balancePence: null }), TODAY), null);
  assert.equal(whatIf(data({ balancePence: null }), TODAY, {}), null);
});

test("a pay step counts from its month's payday by the rule, whatever day of the month it was typed for", () => {
  const today = "2026-11-23";
  for (const fromOn of ["2027-01-31", "2027-01-01"]) {
    const income = [
      { fromOn: "2026-12-31", pence: 130_600, grossYearPence: null },
      { fromOn, pence: 228_000, grossYearPence: null },
    ];
    const f = forecast(data({ income }), today)!;
    assert.deepEqual(
      f.paydays.find((p) => p.day === "2027-01-29"),
      { day: "2027-01-29", pence: 228_000 },
      fromOn,
    );
    assert.equal(payOn("2027-01-29", income, null, "last-working-day"), 228_000, fromOn);
    assert.equal(payOn("2026-12-31", income, null, "last-working-day"), 130_600, fromOn);
  }
});
