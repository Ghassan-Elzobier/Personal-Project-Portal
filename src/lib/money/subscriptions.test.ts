import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bill } from "./recurring.ts";
import { monthlyPence, reviewDue, subscriptions, weeklySaving } from "./subscriptions.ts";

// Made-up services and amounts throughout.
const bill = (o: Partial<Bill> = {}): Bill => ({
  id: 1,
  ident: "example-streaming",
  merchantKey: "example-streaming",
  bandPence: null,
  name: "Example Streaming",
  cadence: "monthly",
  anchorOn: "2026-10-10",
  expectedPence: 1000,
  variable: false,
  category: "subscriptions",
  status: "active",
  addedBy: "engine",
  createdAt: "2026-10-11T05:30:00Z",
  lastPaidOn: "2026-11-10",
  lastPence: 1000,
  reviewedOn: null,
  verdict: null,
  ...o,
});

const TODAY = "2026-11-16";

test("a yearly £120 subscription counts £10 a month", () => {
  assert.equal(monthlyPence(bill({ cadence: "yearly", expectedPence: 12000 })), 1000);
  const s = subscriptions(
    [bill({ cadence: "yearly", expectedPence: 12000, anchorOn: "2026-03-01", lastPaidOn: "2026-03-01" })],
    TODAY,
    null,
  );
  assert.equal(s.monthly, 1000);
  assert.equal(s.subscriptions[0].due, "2027-03-01");
});

test("learning bills are totalled apart from subscriptions, and other bills are offered to sort", () => {
  const s = subscriptions(
    [
      bill({ id: 1, expectedPence: 1000 }),
      bill({ id: 2, ident: "example-course", category: "learning", expectedPence: 2500 }),
      bill({ id: 3, ident: "example-mentor", category: "learning", cadence: "yearly", expectedPence: 6000 }),
      bill({ id: 4, ident: "example-energy", category: "energy", expectedPence: 7000 }),
      bill({ id: 5, ident: "example-old", status: "ignored" }),
    ],
    TODAY,
    50000,
  );
  assert.equal(s.monthly, 1000);
  assert.equal(s.learningMonthly, 2500 + 500);
  assert.deepEqual(
    s.learning.map((r) => r.bill.id),
    [2, 3],
  );
  assert.deepEqual(
    s.others.map((b) => b.id),
    [4],
  );
  assert.equal(s.shareOfPay, 2, "£10 of a £500 pay");
});

test("with no pay known there is no share of pay", () => {
  assert.equal(subscriptions([bill()], TODAY, null).shareOfPay, null);
});

test("a bill reviewed 91 days ago is due for review, one reviewed 89 days ago is not, and one never reviewed is", () => {
  assert.equal(reviewDue(bill({ reviewedOn: "2026-08-17" }), TODAY), true, "91 days");
  assert.equal(reviewDue(bill({ reviewedOn: "2026-08-19" }), TODAY), false, "89 days");
  assert.equal(reviewDue(bill({ reviewedOn: null }), TODAY), true);
});

test("a monthly £10 bill frees 231 pence a week when cancelled, and a cancelled one still being paid says so", () => {
  assert.equal(weeklySaving(bill()), 231);
  const [r] = subscriptions([bill({ verdict: "cancel", reviewedOn: TODAY })], TODAY, null).subscriptions;
  assert.equal(r.cancelling, true);
  assert.equal(r.ask, false);
  assert.equal(r.weeklySaving, 231);
});
