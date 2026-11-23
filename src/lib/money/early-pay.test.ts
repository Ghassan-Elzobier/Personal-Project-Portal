import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./autopilot.ts";
import { budgetView, type BudgetData, type Goal } from "./budget.ts";
import { forecast, payIgnored, payOn, spotPay } from "./forecast.ts";

// Made-up money: pay that comes early before Christmas. Payday is the last working day,
// from 31 December 2026; the next is Friday 29 January 2027.
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
  balancePence: 100_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  planned: [],
  bills: [],
  income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }],
  lastPay: null,
  weeklyFloorPence: 12_000,
  weekAmount: null,
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

test("pay that lands early is shared out the day it lands, as that payday's, and the payday itself does nothing more", () => {
  const early = data({
    income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }],
    lastPay: { day: "2026-12-23", pence: 130_600 },
    weekAmount: null,
  });
  const landed = decide(early, { lastWeekClosed: "2026-12-14", lastPaydayDone: "2026-11-30" }, [], "2026-12-23").apply;
  assert.equal(landed.payday_done, "2026-12-31");
  assert.ok(
    (landed.set_aside ?? []).some((s) => s.goal === 2 && s.pence > 0),
    "the account's goal gets its share",
  );
  assert.ok(
    (landed.payday_transfers?.transfers ?? []).some((t) => t.goal === 1 && t.pence > 0),
    "the saver's move",
  );
  const onTheDay = decide(
    early,
    { lastWeekClosed: "2026-12-21", lastPaydayDone: "2026-12-31" },
    [],
    "2026-12-31",
  ).apply;
  assert.equal(onTheDay.payday_done, undefined);
  assert.equal(onTheDay.payday_transfers, undefined);
  assert.equal(onTheDay.set_aside, undefined);
});

test("a transfer made the day early pay landed counts for that payday", () => {
  const early = data({ lastPay: { day: "2026-12-23", pence: 228_000 } });
  const plan = decide(early, { lastWeekClosed: "2026-12-14", lastPaydayDone: "2026-11-30" }, [], "2026-12-23").apply;
  const moves = (plan.payday_transfers?.transfers ?? []).map((t) => ({
    goal: t.goal,
    on: "2026-12-24",
    pence: t.pence,
  }));
  assert.ok(moves.length > 0);
  const later = data({ lastPay: { day: "2026-12-23", pence: 228_000 }, paydayTransfers: plan.payday_transfers! });
  const { alerts } = decide(later, { lastWeekClosed: "2026-12-28", lastPaydayDone: "2026-12-31" }, moves, "2027-01-04");
  assert.deepEqual(alerts, []);
});

test("pay that lands early is that payday's pay: no second jump on the payday, and the cycle runs to the next one", () => {
  const early = data({ lastPay: { day: "2026-12-23", pence: 130_600 } });
  const f = forecast(early, "2026-12-24")!;
  assert.equal(
    f.events.find((e) => e.day === "2026-12-31" && e.name === "Pay"),
    undefined,
  );
  assert.equal(f.events.find((e) => e.name === "Pay")?.day, "2027-01-29");
  assert.equal(f.paydays[0].day, "2027-01-29");
  assert.equal(budgetView(early, "2026-12-24").payday, "2027-01-29");
  assert.equal(budgetView(data(), "2026-12-24").payday, "2026-12-31", "without the pay in, payday is the rule's");
  assert.equal(
    budgetView(data({ lastPay: { day: "2026-12-10", pence: 130_600 } }), "2026-12-24").payday,
    "2026-12-31",
    "a pay more than 14 days before isn't this payday's",
  );
});

test("the engine spots pay that came early: within 14 days before the payday and a fifth of the pay expected", () => {
  const plan = {
    paydayRule: "last-working-day",
    firstPayday: "2026-12-31",
    income: [{ fromOn: "2026-12-31", pence: 130_600, grossYearPence: null }],
  };
  assert.equal(spotPay([{ id: 7, madeOn: "2026-12-23", pence: 130_000 }], plan, "2026-12-23"), 7);
  assert.equal(spotPay([{ id: 8, madeOn: "2026-12-23", pence: 90_000 }], plan, "2026-12-23"), null, "too far off");
  assert.equal(spotPay([{ id: 9, madeOn: "2026-12-10", pence: 130_600 }], plan, "2026-12-23"), null, "too early");
});

test("a real pay far from the step's figure doesn't become every month's pay, and the page says which it uses", () => {
  const step = [{ fromOn: "2026-12-01", pence: 130_600, grossYearPence: null }];
  assert.equal(payOn("2027-01-29", step, { day: "2026-12-31", pence: 60_000 }), 130_600);
  assert.equal(payOn("2027-01-29", step, { day: "2026-12-31", pence: 131_000 }), 131_000);
  assert.equal(payOn("2027-01-29", [], { day: "2026-12-31", pence: 60_000 }), 60_000, "no step: the real pay");
  assert.equal(payIgnored("2027-01-29", step, { day: "2026-12-31", pence: 60_000 }), 130_600);
  assert.equal(payIgnored("2027-01-29", step, { day: "2026-12-31", pence: 131_000 }), null);
  assert.equal(payIgnored("2027-01-29", [], { day: "2026-12-31", pence: 60_000 }), null);
});
