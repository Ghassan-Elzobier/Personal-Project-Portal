import { test } from "node:test";
import assert from "node:assert/strict";
import { byWeek, type Txn } from "./state.ts";

const txn = (id: number, on: string, pence: number, pending = false): Txn => ({
  id,
  accountId: 1,
  status: pending ? "pending" : "booked",
  source: "lunchflow",
  bookedOn: pending ? null : on,
  madeOn: on,
  pence,
  method: "card",
  description: `EXAMPLE SHOP ${id}`,
  counterparty: null,
  note: null,
  categoryId: null,
  categoryBy: null,
});

test("payments fold into money weeks, newest first, with pending ones in this week", () => {
  // Monday 16 November 2026. Sunday the 15th and Monday the 16th are in different weeks.
  const weeks = byWeek(
    [
      txn(1, "2026-11-15", -1000),
      txn(2, "2026-11-16", -250),
      txn(3, "2026-11-14", -500, true),
      txn(4, "2026-11-09", 20000),
      txn(5, "2026-11-02", -199),
    ],
    "2026-11-16",
  );
  assert.deepEqual(
    weeks.map((w) => [w.monday, w.days.map((d) => d.day), w.out, w.in]),
    [
      ["2026-11-16", [null, "2026-11-16"], 750, 0],
      ["2026-11-09", ["2026-11-15", "2026-11-09"], 1000, 20000],
      ["2026-11-02", ["2026-11-02"], 199, 0],
    ],
  );
  assert.deepEqual(byWeek([], "2026-11-16"), []);
});
