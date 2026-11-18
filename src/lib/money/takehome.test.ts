import { test } from "node:test";
import assert from "node:assert/strict";
import { TAX_YEAR, takeHome } from "./takehome.ts";

// Made-up salaries, worked by hand from the 2026/27 rates.

test("£30,000: tax on £17,430 at 20%, NI at 8%, and £2,093.30 a month", () => {
  const t = takeHome({ grossYearPence: 3_000_000 });
  assert.equal(t.tax, 348_600);
  assert.equal(t.ni, 139_440);
  assert.equal(t.yearPence, 2_511_960);
  assert.equal(t.monthPence, 209_330);
});

test("£60,000: the higher rate above £50,270, and NI at 2% above it", () => {
  const t = takeHome({ grossYearPence: 6_000_000 });
  assert.equal(t.tax, 1_143_200);
  assert.equal(t.ni, 321_060);
  assert.equal(t.yearPence, 4_535_740);
});

test("£110,000: the allowance shrinks by £1 for every £2 over £100,000", () => {
  const t = takeHome({ grossYearPence: 11_000_000 });
  assert.equal(t.tax, 3_343_200);
  assert.equal(t.yearPence, 7_235_740);
});

test("£130,000: the additional rate above £125,140, with no allowance left", () => {
  const t = takeHome({ grossYearPence: 13_000_000 });
  // 37,700 at 20% + 87,440 at 40% + 4,860 at 45%.
  assert.equal(t.tax, 754_000 + 3_497_600 + 218_700);
});

test("student loans: 9% over each plan's threshold, 6% over the postgraduate one", () => {
  assert.equal(takeHome({ grossYearPence: 3_500_000, loans: ["plan2"] }).loans, 50_535);
  assert.equal(takeHome({ grossYearPence: 3_500_000, loans: ["plan5"] }).loans, 90_000);
  assert.equal(takeHome({ grossYearPence: 3_500_000, loans: ["plan2", "postgrad"] }).loans, 50_535 + 84_000);
  assert.equal(takeHome({ grossYearPence: 2_500_000, loans: ["plan2"] }).loans, 0);
});

test("a 5% pension: salary sacrifice saves tax and NI, net pay saves tax, relief at source costs 80%", () => {
  const plain = takeHome({ grossYearPence: 3_000_000 });
  const sacrifice = takeHome({
    grossYearPence: 3_000_000,
    pensionPercent: 5,
    pensionKind: "salary-sacrifice",
  });
  const net = takeHome({
    grossYearPence: 3_000_000,
    pensionPercent: 5,
    pensionKind: "net-pay",
  });
  const ras = takeHome({
    grossYearPence: 3_000_000,
    pensionPercent: 5,
    pensionKind: "relief-at-source",
  });
  assert.equal(sacrifice.pension, 150_000);
  assert.equal(sacrifice.tax, plain.tax - 30_000);
  assert.equal(sacrifice.ni, plain.ni - 12_000);
  assert.equal(net.tax, plain.tax - 30_000);
  assert.equal(net.ni, plain.ni);
  assert.equal(ras.pension, 120_000);
  assert.equal(ras.tax, plain.tax);
  assert.ok(sacrifice.yearPence > net.yearPence && net.yearPence === ras.yearPence);
});

test("the rates are for the tax year we're in (update takehome.ts each April)", () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(today >= TAX_YEAR.from && today <= TAX_YEAR.to, `takehome.ts holds ${TAX_YEAR.from} to ${TAX_YEAR.to}`);
});
