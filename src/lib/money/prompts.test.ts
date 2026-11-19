import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetView, type BudgetData, type Goal } from "./budget.ts";
import { forecast } from "./forecast.ts";
import { prompts } from "./prompts.ts";
import type { Bill } from "./recurring.ts";
import type { Alert } from "./state.ts";

// Made-up money; payday the last working day of each month.
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
const saver: Goal = {
  id: 7,
  name: "Emergency fund",
  kind: "saving",
  targetPence: 400_000,
  dueOn: null,
  repeatsYearly: false,
  held: "elsewhere",
  savedPence: 0,
  savedOn: "2026-11-01",
  aprBp: null,
  paymentPence: null,
  merchantKey: "example-saver",
  category: null,
  position: 1,
  status: "active",
  addedBy: "owner",
  movedPence: 0,
  spentPence: 0,
};
const data = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 100_000,
  allowancePence: null,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: null,
  categories: [],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  bills: [rent],
  ...o,
});
const run = (d: BudgetData, today: string, alerts: Alert[] = []) =>
  prompts(d, budgetView(d, today), forecast(d, today), alerts, today);
const alert = (id: number, kind: string, detail: Record<string, unknown> = {}): Alert => ({
  id,
  kind,
  raisedAt: "",
  payment: kind === "watched" ? { madeOn: "2026-12-06", pence: -1_850, name: "EXAMPLE TAKEAWAY" } : null,
  detail,
});

test("on payday, the plan's moves come first", () => {
  const d = data({ income: [{ fromOn: "2026-11-30", pence: 228_000, grossYearPence: null }], goals: [saver] });
  const [p] = run(d, "2026-12-01");
  assert.equal(p.key, "payday:2026-11-30");
  assert.match(p.text, /^Payday: move £[\d,.]+ to Emergency fund\.$/);
});

test("a bill going out tomorrow says whether the balance covers it", () => {
  assert.equal(run(data(), "2026-12-07")[0].text, "Rent: £500.00 goes out tomorrow. Your balance covers it.");
  const short = run(data({ balancePence: 30_000 }), "2026-12-07")[0];
  assert.equal(short.text, "Rent: £500.00 goes out tomorrow. Your balance is £200.00 short.");
  assert.equal(short.tone, "warn");
});

test("the forecast heading under the buffer within two weeks names the day", () => {
  const p = run(data({ bills: [], allowancePence: 14_000, balancePence: 20_000, bufferPence: 5_000 }), "2026-11-18");
  assert.match(p[0].text, /^Your balance is heading for £[\d.]+ on \w{3} \d+ \w{3}, under your buffer\./);
});

test("two at most: a watched merchant outranks a price rise, and over this week comes last", () => {
  const d = data({ bills: [], allowancePence: 10_000, unsortedWeek: 12_000 });
  const p = run(d, "2026-11-18", [
    alert(1, "price-rise", { name: "Example Streaming", from_pence: 1_099, to_pence: 1_299, on: "2026-11-10" }),
    alert(2, "watched"),
  ]);
  assert.deepEqual(
    p.map((x) => x.key),
    ["alert:2", "alert:1"],
  );
  assert.equal(p[0].alertId, 2);
  const over = run(d, "2026-11-18");
  assert.equal(over[0].text, "£20.00 over this week's amount. It comes off next week.");
});

test("nothing needs you, nothing is said", () => {
  assert.deepEqual(run(data({ bills: [] }), "2026-11-18"), []);
});
