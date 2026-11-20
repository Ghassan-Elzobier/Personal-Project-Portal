import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES } from "./allergens.ts";
import {
  buildList,
  delivery,
  landShop,
  undoOf,
  undoShop,
  type Need,
  type StockChange,
  type StockRow,
} from "./shopping.ts";

// A shop lands in the kitchen: a fresh pack replaces a remainder already past its
// date, instead of topping it up and giving it the new pack's date, and Undo puts
// the kitchen back exactly as it was, dates and all.

/** `life_stock` as the database runs it (supabase/migrations/20261112120000_life.sql). */
function apply(stock: StockRow[], changes: StockChange[], mode: "add" | "set"): StockRow[] {
  const rows = new Map(stock.map((r) => [r.item, { ...r }]));
  for (const c of changes) {
    const row = rows.get(c.item);
    if (!row) {
      rows.set(c.item, {
        item: c.item,
        qty: Math.max(0, c.qty ?? 0),
        status: c.status ?? null,
        goodUntil: c.good_until || null,
      });
      continue;
    }
    if (c.qty !== undefined) row.qty = Math.max(0, mode === "add" ? row.qty + c.qty : c.qty);
    if ("status" in c) row.status = c.status ?? null;
    if ("good_until" in c) row.goodUntil = c.good_until || null;
  }
  return [...rows.values()];
}

const DAY = "2026-11-16";
const need = (item: string, qty: number): Need => ({ item, qty, firstUse: "2026-11-17", uses: ["x"] });
const before: StockRow[] = [
  { item: "chicken-thigh", qty: 300, status: null, goodUntil: "2026-11-14" },
  { item: "milk", qty: 500, status: null, goodUntil: "2026-11-25" },
  { item: "olive-oil", qty: 0, status: "low", goodUntil: null },
];
const lines = buildList(
  [need("chicken-thigh", 1200), need("milk", 2000), need("olive-oil", 30)],
  before,
  [],
  NO_RULES,
  DAY,
);
const changes = delivery(
  lines,
  lines.map((l) => l.item.key),
  DAY,
);
const landed = landShop(changes, before, DAY);
const after = apply(apply(before, landed.set, "set"), landed.add, "add");
const rowOf = (rows: StockRow[], item: string) => rows.find((r) => r.item === item)!;

test("a fresh pack replaces a remainder past its date, and tops up one still good", () => {
  const chicken = lines.find((l) => l.item.key === "chicken-thigh")!;
  const milk = lines.find((l) => l.item.key === "milk")!;
  assert.deepEqual(landed.dropped, [{ item: "chicken-thigh", qty: 300, goodUntil: "2026-11-14" }]);
  // The 300 g gone off is not carried into the new pack's date.
  assert.equal(rowOf(after, "chicken-thigh").qty, chicken.packs * 1000);
  assert.ok(rowOf(after, "chicken-thigh").goodUntil! > DAY);
  // Milk still in date is topped up.
  assert.ok(milk.packs > 0);
  assert.equal(rowOf(after, "milk").qty, 500 + changes.find((c) => c.item === "milk")!.add);
  assert.equal(rowOf(after, "olive-oil").status, "have");
});

test("Undo puts the kitchen back exactly: amounts, staples and every date", () => {
  const { added, restore } = undoOf(changes, before);
  const undo = undoShop({ added, restore, dropped: landed.dropped, dates: landed.dates });
  const back = apply(apply(after, undo.add, "add"), undo.set, "set");
  assert.deepEqual(
    back.sort((a, b) => a.item.localeCompare(b.item)),
    [...before].sort((a, b) => a.item.localeCompare(b.item)),
  );
});

test("a shop that changes no date and replaces nothing records nothing extra", () => {
  const none = landShop([{ item: "olive-oil", add: 0, status: "have", goodUntil: null }], before, DAY);
  assert.deepEqual([none.dropped, none.dates, none.set], [[], [], []]);
  assert.deepEqual(undoShop({}), { add: [], set: [] });
});
