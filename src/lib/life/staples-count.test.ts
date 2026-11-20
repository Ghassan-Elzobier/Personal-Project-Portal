import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES } from "./allergens.ts";
import { takenFromStock } from "./cooked.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { recipe } from "./recipes.ts";
import {
  buildList,
  cookUse,
  delivery,
  landShop,
  undoOf,
  undoShop,
  type Need,
  type Product,
  type StockChange,
  type StockRow,
} from "./shopping.ts";
import { countDown, countedDelivery, lowBelow, markByHand, putBack, stapleUse, staplesAhead } from "./staples-count.ts";

// Cupboard staples count themselves down: a shop counts a staple's pack in, cooks
// and meals made on the spot take their amounts off counted staples only, and one
// that won't last the week ahead turns low. Undo puts every amount back. Made-up
// kitchen throughout.

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

/** `life_stock_move`, which a cook (-1) and its Undo (+1) run on what the cook used. */
function move(stock: StockRow[], used: { item: string; qty: number }[], sign: 1 | -1): StockRow[] {
  return apply(
    stock,
    used.map((u) => ({ item: u.item, qty: sign * u.qty })),
    "add",
  );
}

const sorted = (rows: StockRow[]) => [...rows].sort((a, b) => a.item.localeCompare(b.item));
const rowOf = (rows: StockRow[], item: string) => rows.find((r) => r.item === item);
const row = (item: string, qty: number, status: StockRow["status"]): StockRow => ({
  item,
  qty,
  status,
  goodUntil: null,
});
const DAY = "2026-11-16";
const need = (item: string, qty: number): Need => ({ item, qty, firstUse: "2026-11-17", uses: ["x"] });
const NONE = new Map<string, number>();

test("a shop counts each staple's pack in, in its own unit, and leaves fresh food as it was", () => {
  const before = [row("olive-oil", 0, "low"), row("cumin", 0, "out")];
  const lines = buildList([need("olive-oil", 30), need("cumin", 4), need("carrot", 500)], before, [], NO_RULES, DAY);
  const got = lines.map((l) => l.item.key);
  const changes = countedDelivery(lines, got, DAY);
  const of = (item: string) => changes.find((c) => c.item === item)!;
  assert.equal(of("olive-oil").add, INGREDIENTS.get("olive-oil")!.pack.qty);
  assert.equal(of("olive-oil").status, "have");
  assert.equal(of("cumin").add, INGREDIENTS.get("cumin")!.pack.qty);
  // Everything but the staples' amounts is the same as before counting.
  const plain = delivery(lines, got, DAY);
  assert.deepEqual(
    changes.map((c) => ({ ...c, add: INGREDIENTS.get(c.item)!.staple ? 0 : c.add })),
    plain,
  );
});

test("a shop counts the pack of the product you picked", () => {
  const product: Product = {
    item: "olive-oil",
    url: "https://www.sainsburys.co.uk/gol-ui/product/example-olive-oil-1l",
    name: "Example olive oil 1 l",
    packQty: 1000,
    packUnit: "ml",
    pence: 600,
    checked: [],
  };
  const litre = buildList([need("olive-oil", 30)], [], [product], NO_RULES, DAY);
  assert.equal(countedDelivery(litre, ["olive-oil"], DAY)[0].add, 1000);
  // A pack saved in a unit oil can't be counted in falls back to the usual bottle.
  const wrong = buildList([need("olive-oil", 30)], [], [{ ...product, packQty: 2, packUnit: "each" }], NO_RULES, DAY);
  assert.equal(countedDelivery(wrong, ["olive-oil"], DAY)[0].add, 500);
});

test("Undo of a shop takes the counted amounts back out, exactly", () => {
  const before = [row("olive-oil", 40, "low"), row("cumin", 0, "out"), row("carrot", 200, null)];
  const lines = buildList([need("olive-oil", 30), need("cumin", 4), need("carrot", 900)], before, [], NO_RULES, DAY);
  const changes = countedDelivery(
    lines,
    lines.map((l) => l.item.key),
    DAY,
  );
  const landed = landShop(changes, before, DAY);
  const after = apply(apply(before, landed.set, "set"), landed.add, "add");
  assert.deepEqual(rowOf(after, "olive-oil"), row("olive-oil", 540, "have"));

  const { added, restore } = undoOf(changes, before);
  const undo = undoShop({ added, restore, dropped: landed.dropped, dates: landed.dates });
  const back = apply(apply(after, undo.add, "add"), undo.set, "set");
  assert.deepEqual(sorted(back), sorted(before));
});

test("a cook takes its staples off counted ones only, and Undo cook puts them back", () => {
  const bolognese = recipe("bolognese")!;
  const before = [
    row("olive-oil", 500, "have"),
    // Marked by hand, never counted: as it was before counting.
    row("oregano", 0, "have"),
    row("beef-mince", 1000, null),
    row("onion", 600, null),
  ];
  const staples = countDown(stapleUse(bolognese, 6, 1), before, NONE, []);
  assert.deepEqual(staples.taken, [{ item: "olive-oil", qty: 20 }]);
  assert.deepEqual(staples.low, []);

  // What the cook records as used, as logCook builds it, comes out of the kitchen…
  const used = [...takenFromStock(cookUse(bolognese, 6, 1), before), ...staples.taken];
  const cooked = move(before, used, -1);
  assert.equal(rowOf(cooked, "olive-oil")!.qty, 480);
  assert.deepEqual(rowOf(cooked, "oregano"), row("oregano", 0, "have"));
  // …and Undo cook puts back exactly that.
  assert.deepEqual(sorted(move(cooked, used, 1)), sorted(before));
});

test("a daily meal takes its staples off counted ones only", () => {
  const shake = recipe("chocolate-shake")!;
  const before = [row("rice-protein", 900, "have"), row("honey", 0, "low")];
  const { taken, stock } = countDown(stapleUse(shake, 1, 1), before, NONE, []);
  assert.deepEqual(taken, [{ item: "rice-protein", qty: 30 }]);
  assert.deepEqual(rowOf(stock, "rice-protein"), row("rice-protein", 870, "have"));
  assert.deepEqual(rowOf(stock, "honey"), row("honey", 0, "low"));
  // The next meal in a run starts from what this one left.
  assert.equal(rowOf(countDown(stapleUse(shake, 1, 1), stock, NONE, []).stock, "rice-protein")!.qty, 840);
});

test("a staple turns low when it won't last the week ahead, or falls under about 15% of a pack", () => {
  const oil = INGREDIENTS.get("olive-oil")!;
  assert.equal(lowBelow(oil, undefined, 0), 75);
  assert.equal(lowBelow(oil, undefined, 120), 120);

  const use = [{ item: "olive-oil", qty: 20 }];
  // 100 ml left after this cook, and the week ahead needs 120: low.
  const short = countDown(use, [row("olive-oil", 120, "have")], new Map([["olive-oil", 120]]), []);
  assert.deepEqual(short.low, ["olive-oil"]);
  assert.equal(rowOf(short.stock, "olive-oil")!.status, "low");
  // 100 ml left, the week needs 60, above 15% of a 500 ml bottle: still have.
  assert.deepEqual(countDown(use, [row("olive-oil", 120, "have")], new Map([["olive-oil", 60]]), []).low, []);
  // 70 ml left and nothing more planned: under 15% of the bottle, low.
  assert.deepEqual(countDown(use, [row("olive-oil", 90, "have")], NONE, []).low, ["olive-oil"]);
  // Already low or out stays as it is; nothing turns it back to have.
  assert.deepEqual(countDown(use, [row("olive-oil", 90, "low")], NONE, []).low, []);
  assert.equal(rowOf(countDown(use, [row("olive-oil", 90, "out")], NONE, []).stock, "olive-oil")!.status, "out");
});

test("a cook takes no more of a staple than is counted, so Undo adds nothing that wasn't there", () => {
  const before = [row("olive-oil", 12.5, "have")];
  const { taken, low, stock } = countDown([{ item: "olive-oil", qty: 20 }], before, NONE, []);
  assert.deepEqual(taken, [{ item: "olive-oil", qty: 12.5 }]);
  assert.deepEqual(low, ["olive-oil"]);
  assert.equal(rowOf(stock, "olive-oil")!.qty, 0);
  assert.equal(rowOf(move(move(before, taken, -1), taken, 1), "olive-oil")!.qty, 12.5);
});

test("an uncounted staple is untouched by cooking, eating and unticking", () => {
  const before = [row("cumin", 0, "have"), row("salt", 0, "low"), row("paprika", 0, "out")];
  const uses = [
    { item: "cumin", qty: 4 },
    { item: "salt", qty: 2 },
    { item: "paprika", qty: 3 },
    { item: "turmeric", qty: 2 },
  ];
  const r = countDown(uses, before, new Map([["cumin", 100]]), []);
  assert.deepEqual([r.taken, r.low], [[], []]);
  assert.deepEqual(sorted(r.stock), sorted(before));
  assert.deepEqual(putBack(uses, before), []);
});

test("unticking a meal puts its staples back on counted ones only", () => {
  const stock = [row("rice-protein", 870, "have"), row("honey", 0, "have")];
  const uses = [
    { item: "rice-protein", qty: 30 },
    { item: "honey", qty: 20 },
  ];
  assert.deepEqual(putBack(uses, stock), [{ item: "rice-protein", qty: 30 }]);
});

test("fresh food is never counted as a staple", () => {
  const r = countDown([{ item: "beef-mince", qty: 500 }], [row("beef-mince", 1000, null)], NONE, []);
  assert.deepEqual(r.taken, []);
});

test("the week ahead counts staples' uses over the next seven days only", () => {
  const needs: Need[] = [
    {
      item: "olive-oil",
      qty: 45,
      firstUse: "2026-11-14",
      uses: ["a", "b", "c"],
      at: [
        { date: "2026-11-14", qty: 10, use: "a" },
        { date: "2026-11-22", qty: 15, use: "b" },
        { date: "2026-11-23", qty: 20, use: "c" },
      ],
    },
    { item: "carrot", qty: 500, firstUse: "2026-11-17", uses: ["x"] },
  ];
  // From the 16th: the 16th to the 22nd, and a cook missed on the 14th is still to make.
  assert.deepEqual([...staplesAhead(needs, "2026-11-16")], [["olive-oil", 25]]);
});

test("marking a counted staple have or out by hand stops counting it; low keeps it counting", () => {
  const counted = row("olive-oil", 60, "low");
  assert.deepEqual(markByHand(counted, "olive-oil", "have"), { item: "olive-oil", status: "have", qty: 0 });
  assert.deepEqual(markByHand(counted, "olive-oil", "out"), { item: "olive-oil", status: "out", qty: 0 });
  assert.deepEqual(markByHand(row("olive-oil", 300, "have"), "olive-oil", "low"), { item: "olive-oil", status: "low" });
  // The mark it already has, an uncounted staple, or none at all: only the mark.
  assert.deepEqual(markByHand(row("olive-oil", 300, "have"), "olive-oil", "have"), {
    item: "olive-oil",
    status: "have",
  });
  assert.deepEqual(markByHand(row("cumin", 0, "low"), "cumin", "have"), { item: "cumin", status: "have" });
  assert.deepEqual(markByHand(undefined, "cumin", "out"), { item: "cumin", status: "out" });
});
