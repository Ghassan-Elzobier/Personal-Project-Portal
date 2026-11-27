import { test } from "node:test";
import assert from "node:assert/strict";
import { transactionsPath } from "./feed.ts";

// Lunch Flow leaves pending payments out of an account's transactions unless the
// request asks for them, so a sync that forgot to ask would never show one as Pending.

test("a sync's transactions request asks for pending payments and the raw bank record, from its day", () => {
  const url = new URL(transactionsPath("9001", "2026-11-01"), "https://example.test");
  assert.equal(url.pathname, "/accounts/9001/transactions");
  assert.equal(url.searchParams.get("from"), "2026-11-01");
  assert.equal(url.searchParams.get("include_pending"), "true");
  assert.equal(url.searchParams.get("include_raw"), "true");
});

test("an account id goes in the path as one segment", () => {
  const url = new URL(transactionsPath("a/b c", "2026-11-01"), "https://example.test");
  assert.equal(url.pathname, "/accounts/a%2Fb%20c/transactions");
});
