import { test } from "node:test";
import assert from "node:assert/strict";
import { monthView, parseMoney } from "./state.ts";

// What money_read returns for categories, with made-up budgets and spending.
const raw = {
  month: "2026-11-01",
  unsorted: 2,
  categories: [
    { id: 1, key: "pay", name: "Pay", kind: "income", budget_pence: null, out_pence: 0, in_pence: 130600 },
    { id: 2, key: "rent", name: "Rent", kind: "bills", budget_pence: 50000, out_pence: 50000, in_pence: 0 },
    {
      id: 3,
      key: "groceries",
      name: "Groceries",
      kind: "groceries",
      budget_pence: 30000,
      out_pence: 31250,
      in_pence: 0,
    },
    {
      id: 4,
      key: "eating-out",
      name: "Eating out",
      kind: "discretionary",
      budget_pence: 6000,
      out_pence: 1500,
      in_pence: 0,
    },
    { id: 5, key: "fun", name: "Fun and social", kind: "discretionary", budget_pence: null, out_pence: 0, in_pence: 0 },
    { id: 6, key: "cash", name: "Cash", kind: "discretionary", budget_pence: null, out_pence: 2000, in_pence: 0 },
    { id: 7, key: "transfers", name: "Transfers", kind: "transfer", budget_pence: null, out_pence: 9000, in_pence: 0 },
  ],
  rules: [
    { id: 9, field: "merchant", pattern: "example-cafe", category: "eating-out", watch: false, position: -1 },
    { id: 10, field: "description", pattern: "tesco", category: "groceries", watch: false, position: 1000 },
  ],
  alerts: [
    {
      id: 3,
      kind: "watched",
      raised_at: "2026-11-18T10:00:00Z",
      payment: { made_on: "2026-11-18", pence: -1800, name: "Example Takeaway" },
    },
  ],
};

test("the month shows spending against budgets, leaving out income, transfers and empty categories", () => {
  const m = monthView(parseMoney(raw).categories);
  assert.deepEqual(
    m.rows.map((c) => [c.key, c.share, c.over]),
    [
      ["rent", 1, false],
      ["groceries", 1, true],
      ["eating-out", 0.25, false],
      ["cash", null, false],
    ],
  );
  assert.equal(m.out, 50000 + 31250 + 1500 + 2000);
  assert.equal(m.budget, 50000 + 30000 + 6000);
});

test("rules know which are the starter set, and an alert names its payment", () => {
  const s = parseMoney(raw);
  assert.deepEqual(
    s.rules.map((r) => [r.pattern, r.starter]),
    [
      ["example-cafe", false],
      ["tesco", true],
    ],
  );
  assert.deepEqual(s.alerts[0].payment, { madeOn: "2026-11-18", pence: -1800, name: "Example Takeaway" });
  assert.equal(s.unsorted, 2);
});
