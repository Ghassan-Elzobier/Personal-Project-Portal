import { test } from "node:test";
import assert from "node:assert/strict";
import { accountChoice, accountChoices, balanceOf, BankError, toPence } from "./map.ts";

// Made-up accounts in Lunch Flow's shape (the IBAN is a published example, not a real account).
const current = {
  id: 101,
  name: "000000 Example12345678",
  status: "ACTIVE",
  raw: {
    gocardless: {
      iban: "GB33BUKB20201555555555",
      scan: "20201555555555",
      name: "Example Holder",
      cashAccountType: "CACC",
      currency: "GBP",
    },
  },
};

test("an account keeps its type and last 4 digits, and nothing else that names it", () => {
  const a = accountChoice(current);
  assert.deepEqual(a, { uid: "101", name: "Current account", kind: "current", last4: "5555", currency: "GBP" });
  assert.ok(!JSON.stringify(a).includes("Example"), "no holder or bank name");
  assert.ok(!JSON.stringify(a).includes("2020155"), "no sort code or full number");
});

test("savings and unknown accounts are named by type, and stopped accounts are left out", () => {
  const list = accountChoices({
    accounts: [
      current,
      { id: "202", status: "ACTIVE", raw: { gocardless: { cashAccountType: "SVGS", scan: "123" } } },
      { id: 303, status: "EXPIRED", raw: { gocardless: { cashAccountType: "CACC" } } },
      { id: 404, raw: { gocardless: { cashAccountType: "XXXX" } } },
    ],
    total: 4,
  });
  assert.deepEqual(
    list.map((a) => [a.uid, a.name, a.last4]),
    [
      ["101", "Current account", "5555"],
      ["202", "Savings account", null],
      ["404", "Account", null],
    ],
  );
  assert.throws(() => accountChoices({ accounts: "nope" }), BankError);
});

test("amounts become exact pence, and anything finer than a penny is refused", () => {
  assert.equal(toPence(3185.6), 318560);
  assert.equal(toPence("-42.05"), -4205);
  assert.equal(toPence(7), 700);
  assert.equal(toPence("0.5"), 50);
  assert.equal(toPence(-0), 0);
  assert.throws(() => toPence(0.1 + 0.2), /BANK_SYNC:AMOUNT/);
  assert.throws(() => toPence("12,50"), BankError);
  assert.throws(() => toPence(null), BankError);
});

test("a balance is the available figure in pence, and a missing one is a code, not a crash", () => {
  assert.deepEqual(balanceOf({ balance: { amount: 1234.56, currency: "GBP" } }), { kind: "available", pence: 123456 });
  assert.throws(
    () => balanceOf({}),
    (e) => e instanceof BankError && e.code === "BAD_BALANCE",
  );
});
