import { test } from "node:test";
import assert from "node:assert/strict";
import { byDay, parseMoney, parseTransactions, txnName } from "./state.ts";

// What money_transactions returns, with made-up values.
const raw = [
  {
    id: 1,
    account_id: 7,
    status: "booked",
    source: "lunchflow",
    booked_on: "2026-11-10",
    made_on: "2026-11-09",
    pence: -1234,
    method: "card",
    description: "EXAMPLE GROCER LONDON",
    counterparty: "Example Grocer Ltd",
    merchant_key: "example-grocer",
    note: null,
  },
  {
    id: 2,
    account_id: 7,
    status: "booked",
    source: "statement",
    booked_on: "2026-11-10",
    made_on: "2026-11-10",
    pence: 130600,
    method: "transfer",
    description: "EXAMPLE LTD, SALARY",
    counterparty: null,
    merchant_key: "example-ltd",
    note: "First pay",
  },
  {
    id: 3,
    account_id: 7,
    status: "booked",
    source: "lunchflow",
    booked_on: "2026-11-11",
    made_on: "2026-11-11",
    pence: -350,
    method: "card",
    description: "EXAMPLE CAFE",
    counterparty: null,
    merchant_key: "example-cafe",
    note: null,
  },
  {
    id: 4,
    account_id: 7,
    status: "pending",
    source: "lunchflow",
    booked_on: null,
    made_on: "2026-11-12",
    pence: -500,
    method: "card",
    description: "EXAMPLE BAKERY",
    counterparty: null,
    merchant_key: "example-bakery",
    note: null,
  },
];

test("transactions read back with their payee, and pending ones come first, then each day newest first", () => {
  const txns = parseTransactions(raw);
  assert.equal(txnName(txns[0]), "Example Grocer Ltd", "the payee's name when the bank gives one");
  assert.equal(txnName(txns[2]), "EXAMPLE CAFE", "else the text");
  const days = byDay(txns);
  assert.deepEqual(
    days.map((d) => [d.day, d.txns.map((t) => t.id), d.out, d.in]),
    [
      [null, [4], 500, 0],
      ["2026-11-11", [3], 350, 0],
      ["2026-11-10", [2, 1], 1234, 130600],
    ],
  );
  assert.deepEqual(parseTransactions(null), []);
});

test("the scheduled sync's key shows once registered", () => {
  assert.equal(parseMoney({}).syncKey, null);
  assert.deepEqual(parseMoney({ sync_key: { created_at: "2026-11-18T12:00:00Z", last_used_at: null } }).syncKey, {
    createdAt: "2026-11-18T12:00:00Z",
    lastUsedAt: null,
  });
});
