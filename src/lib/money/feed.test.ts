import { test } from "node:test";
import assert from "node:assert/strict";
import { feedRows, merchantKey, methodOf, syncFrom } from "./feed.ts";
import { BankError } from "./map.ts";

// Made-up transactions in Lunch Flow's shape, with the raw bank record it adds.
const txn = (o: Record<string, unknown>, g: Record<string, unknown> = {}) => ({
  id: 1,
  amount: -12.34,
  currency: "GBP",
  date: "2026-11-10",
  merchant: "Example Grocer",
  description: "EXAMPLE GROCER",
  isPending: false,
  ...o,
  raw: {
    gocardless: {
      transactionId: "tx-1",
      bookingDate: "2026-11-10",
      valueDate: "2026-11-09",
      transactionAmount: { amount: "-12.34", currency: "GBP" },
      remittanceInformationUnstructured: "EXAMPLE GROCER   LONDON",
      creditorName: "Example Grocer Ltd",
      proprietaryBankTransactionCode: "PaymentType: VP",
      ...g,
    },
  },
});

test("a booked card payment keeps the bank's exact amount, its text, payee and a merchant key", () => {
  const { booked, pending } = feedRows({ transactions: [txn({})], total: 1 }, "2026-11-18");
  assert.equal(pending.length, 0);
  const r = booked[0];
  assert.equal(r.pence, -1234);
  assert.equal(r.ref, "tx-1");
  assert.equal(r.booked_on, "2026-11-10");
  assert.equal(r.value_on, "2026-11-09");
  assert.equal(r.method, "card");
  assert.equal(r.description, "EXAMPLE GROCER LONDON");
  assert.equal(r.counterparty, "Example Grocer Ltd");
  assert.equal(r.merchant_key, "example-grocer");
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
});

test("two identical coffees on one day stay two rows, and the same batch always gives the same fingerprints", () => {
  const coffee = (id: string) =>
    txn(
      { id, amount: -3.5 },
      { transactionId: id, transactionAmount: { amount: "-3.50" }, remittanceInformationUnstructured: "EXAMPLE CAFE" },
    );
  const once = feedRows({ transactions: [coffee("c1"), coffee("c2")] }, "2026-11-18").booked;
  const again = feedRows({ transactions: [coffee("c1"), coffee("c2")] }, "2026-11-18").booked;
  assert.equal(once.length, 2);
  assert.notEqual(once[0].fingerprint, once[1].fingerprint);
  assert.deepEqual(
    once.map((r) => r.fingerprint),
    again.map((r) => r.fingerprint),
  );
});

test("pending payments have no booking day or id, and a zero amount is left out", () => {
  const { booked, pending } = feedRows(
    {
      transactions: [
        txn({ isPending: true }, { transactionId: "tx-p", bookingDate: undefined }),
        txn({ amount: 0 }, { transactionAmount: { amount: "0.00" } }),
      ],
    },
    "2026-11-18",
  );
  assert.equal(booked.length, 0);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].booked_on, null);
  assert.equal(pending[0].ref, null);
  assert.equal(pending[0].made_on, "2026-11-10");
});

test("money in names the payer, and an odd answer is a code", () => {
  const pay = feedRows(
    {
      transactions: [
        txn(
          { amount: 1306 },
          {
            transactionAmount: { amount: "1306.00" },
            debtorName: "Example Ltd",
            creditorName: undefined,
            proprietaryBankTransactionCode: "PaymentType: LA",
          },
        ),
      ],
    },
    "2026-11-18",
  ).booked[0];
  assert.equal(pay.pence, 130600);
  assert.equal(pay.counterparty, "Example Ltd");
  assert.equal(pay.method, "transfer");
  assert.throws(() => feedRows({ nothing: true }, "2026-11-18"), BankError);
});

test("merchant keys and payment methods are short and stable", () => {
  assert.equal(merchantKey("SAINSBURYS S/MKTS LONDON"), "sainsburys-smkts");
  assert.equal(merchantKey("AMZNMKTPLACE*AB12CD"), "amznmktplace");
  assert.equal(merchantKey("TfL Travel Charge"), "tfl-travel");
  assert.equal(merchantKey("12345678"), null);
  assert.equal(methodOf("PaymentType: D7"), "direct-debit");
  assert.equal(methodOf("PaymentType: VW"), "cash");
  assert.equal(methodOf("PaymentType: WE"), "transfer");
  assert.equal(methodOf("PaymentType: CR"), "other");
  assert.equal(methodOf(undefined), "other");
});

test("the first sync reaches back 15 months, and later ones overlap 10 days for late bookings", () => {
  assert.equal(syncFrom(null, "2026-11-18"), "2025-08-19");
  assert.equal(syncFrom("2026-11-17", "2026-11-18"), "2026-11-07");
});
