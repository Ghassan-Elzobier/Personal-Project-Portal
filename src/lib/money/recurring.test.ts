import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adoptions,
  billAlerts,
  dueUntil,
  findBills,
  nextDue,
  yearlyPence,
  type Bill,
  type Found,
  type Payment,
} from "./recurring.ts";

// Made-up merchants and amounts throughout.
const pay = (madeOn: string, pence: number, merchantKey = "example-streaming", categoryId: number | null = null) =>
  ({ madeOn, pence, merchantKey, name: merchantKey.toUpperCase(), categoryId }) satisfies Payment;

const bill = (o: Partial<Bill> = {}): Bill => ({
  id: 1,
  ident: "example-energy",
  merchantKey: "example-energy",
  bandPence: null,
  name: "Example Energy",
  cadence: "monthly",
  anchorOn: "2026-10-08",
  expectedPence: 7000,
  variable: false,
  category: "energy",
  status: "active",
  addedBy: "engine",
  createdAt: "2026-10-09T05:30:00Z",
  lastPaidOn: "2026-10-08",
  lastPence: 7000,
  ...o,
});

test("a merchant paid on the same day each month is a monthly bill, adopted when paid lately", () => {
  const [f] = findBills(
    [pay("2026-08-08", 1299, "example-streaming", 4), pay("2026-09-08", 1299), pay("2026-10-08", 1299)],
    "2026-11-01",
  );
  assert.equal(f.cadence, "monthly");
  assert.equal(f.anchorOn, "2026-10-08");
  assert.equal(f.expectedPence, 1299);
  assert.equal(f.variable, false);
  assert.equal(f.categoryId, 4);
  assert.equal(f.confident, true);
  assert.equal(f.ident, "example-streaming");
});

test("a payment moved off a weekend keeps the bill's usual day", () => {
  const [f] = findBills([pay("2027-01-01", 900), pay("2027-02-01", 900), pay("2027-03-03", 900)], "2027-03-10");
  assert.equal(f.anchorOn, "2027-03-01");
  assert.equal(nextDue(f, "2027-03-10"), "2027-04-01");
});

test("a bill whose amount changes is variable, and counts its highest recent amount to stay cautious", () => {
  const [f] = findBills(
    [
      pay("2026-07-15", 6000, "example-energy"),
      pay("2026-08-15", 7200, "example-energy"),
      pay("2026-09-15", 6500, "example-energy"),
    ],
    "2026-10-01",
  );
  assert.equal(f.variable, true);
  assert.equal(f.expectedPence, 7200);
});

test("a weekly shop of different amounts is not a bill, but a steady weekly payment is", () => {
  const days = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01"];
  assert.deepEqual(
    findBills(
      days.map((d, i) => pay(d, 5000 + i * 900, "example-grocer")),
      "2026-11-03",
    ),
    [],
  );
  const [f] = findBills(
    days.map((d) => pay(d, 500, "example-locker")),
    "2026-11-03",
  );
  assert.equal(f.cadence, "weekly");
  assert.equal(yearlyPence(f), 26_000);
});

test("a yearly bill needs two payments a year apart of the same amount", () => {
  const [f] = findBills(
    [pay("2025-11-20", 9500, "example-books"), pay("2026-11-19", 9500, "example-books")],
    "2026-11-25",
  );
  assert.equal(f.cadence, "yearly");
  assert.equal(nextDue(f, "2026-11-25"), "2027-11-19");
  assert.deepEqual(
    findBills([pay("2025-11-20", 9500, "example-books"), pay("2026-11-19", 4000, "example-books")], "2026-11-25"),
    [],
  );
});

test("one merchant taking two subscriptions gives two bills, told apart by amount", () => {
  const ps = ["08", "09", "10"].flatMap((m) => [
    pay(`2026-${m}-03`, 299, "example-apps"),
    pay(`2026-${m}-20`, 999, "example-apps"),
  ]);
  const found = findBills(ps, "2026-10-25");
  assert.deepEqual(
    found.map((f) => [f.ident, f.expectedPence]),
    [
      ["example-apps~299", 299],
      ["example-apps~999", 999],
    ],
  );
});

test("two payments on one day count as one occurrence", () => {
  const ps = ["08", "09", "10"].flatMap((m) => [
    pay(`2026-${m}-05`, 2000, "example-gym"),
    pay(`2026-${m}-05`, 1000, "example-gym"),
  ]);
  const [f] = findBills(ps, "2026-10-20");
  assert.equal(f.expectedPence, 3000);
  assert.equal(f.count, 3);
});

test("a step up from a steady amount is a price rise, raised only while it's recent", () => {
  const ps = [pay("2026-08-08", 1099), pay("2026-09-08", 1099), pay("2026-10-08", 1299)];
  const [f] = findBills(ps, "2026-10-10");
  assert.deepEqual(f.rise, { from: 1099, to: 1299 });
  const alerts = billAlerts([f], [], "2026-10-10");
  assert.deepEqual(alerts[0], {
    kind: "price-rise",
    dedupe: "price-rise:example-streaming:2026-10-08",
    ident: "example-streaming",
    detail: { from_pence: 1099, to_pence: 1299, on: "2026-10-08", name: "EXAMPLE-STREAMING" },
  });
  assert.deepEqual(billAlerts(findBills(ps, "2026-10-30"), [], "2026-10-30"), []);
});

test("a bill on the 31st falls on the last day of a short month", () => {
  const b = bill({ anchorOn: "2027-01-31", lastPaidOn: "2027-01-31" });
  assert.equal(nextDue(b, "2027-02-02"), "2027-02-28");
  assert.deepEqual(dueUntil(b, "2027-02-02", "2027-04-30"), ["2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("still to pay before payday: the occurrences from the next one not paid, up to payday", () => {
  const b = bill();
  assert.deepEqual(dueUntil(b, "2026-11-18", "2026-11-30"), ["2026-11-08"]);
  assert.deepEqual(dueUntil(bill({ lastPaidOn: "2026-11-09" }), "2026-11-18", "2026-12-31"), ["2026-12-08"]);
  assert.deepEqual(dueUntil(bill({ lastPaidOn: "2026-11-09" }), "2026-11-18", "2026-12-07"), []);
});

test("a bill more than five days late is missed, once per due day", () => {
  assert.deepEqual(billAlerts([], [bill()], "2026-11-12"), []);
  assert.deepEqual(billAlerts([], [bill()], "2026-11-14"), [
    {
      kind: "missed-bill",
      dedupe: "missed-bill:example-energy:2026-11-08",
      ident: "example-energy",
      detail: { due: "2026-11-08", pence: 7000, name: "Example Energy" },
    },
  ]);
  assert.deepEqual(billAlerts([], [bill({ status: "ignored" })], "2026-11-14"), []);
});

test("adopting: confident bills are written, an ignored one never is, and one stopped for 2.5 cycles has ended", () => {
  const found = findBills([pay("2026-08-08", 1299), pay("2026-09-08", 1299), pay("2026-10-08", 1299)], "2026-11-01");
  assert.deepEqual(
    adoptions(found, [], "2026-11-01").map((a) => [a.ident, a.status]),
    [["example-streaming", "active"]],
  );
  assert.deepEqual(adoptions(found, [bill({ ident: "example-streaming", status: "ignored" })], "2026-11-01"), []);
  const stale: Found = { ...found[0], confident: false };
  assert.deepEqual(adoptions([stale], [], "2026-11-01"), []);
  assert.deepEqual(
    adoptions([], [bill({ lastPaidOn: "2026-08-08" })], "2026-11-18").map((a) => [a.ident, a.status]),
    [["example-energy", "ended"]],
  );
});
