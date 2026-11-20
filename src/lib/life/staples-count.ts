// Cupboard staples count themselves down. A shop that brings a staple counts in
// roughly what came (its packs, in the staple's own unit) as well as marking it
// "have"; cooks and meals made on the spot take their share off; and when what is
// left falls below what the week ahead needs of it, or below about 15% of a pack,
// it turns "low" in the same change, so the next list buys it. Only a shop or the
// Cupboard turns it back to "have".
//
// A staple with no amount (marked by hand, never counted) is left as it was, have,
// low or out, exactly as before counting began. Pure, so it is tested.

import { addDays } from "../dates/week.ts";
import { INGREDIENTS, type Ingredient } from "./ingredients.ts";
import type { Recipe } from "./recipes.ts";
import {
  delivery,
  linesFor,
  packInItemUnit,
  type ListLine,
  type Need,
  type Product,
  type StockChange,
  type StockRow,
} from "./shopping.ts";

/** A counted staple with less than this share of a pack left is low, whatever the week needs. */
const LOW_SHARE = 0.15;

type Amount = { item: string; qty: number };

const isStaple = (item: string) => Boolean(INGREDIENTS.get(item)?.staple);
/** To the hundredth, as the kitchen keeps amounts. */
const cents = (x: number) => Math.round(x * 100) / 100;

/** A cupboard staple with an amount recorded: a shop counted it in, and cooking counts it down. */
function counted(row: Pick<StockRow, "item" | "qty"> | undefined): boolean {
  return Boolean(row && row.qty > 0 && isStaple(row.item));
}

/**
 * A shop's changes to the kitchen (`delivery`), with each staple's packs counted in,
 * in its own unit, besides marking it "have". `undoOf` keeps the amount like any
 * other, so Undo takes it back out.
 */
export function countedDelivery(lines: ListLine[], got: string[], deliveredOn: string): ReturnType<typeof delivery> {
  const lineOf = new Map(lines.map((l) => [l.item.key, l]));
  return delivery(lines, got, deliveredOn).map((c) => {
    const l = lineOf.get(c.item);
    if (!l?.item.staple) return c;
    return { ...c, add: cents(l.packs * packInItemUnit(l.item, l.packQty, l.packUnit)) };
  });
}

/** What a recipe at a size uses of each cupboard staple, in the staple's own unit. */
export function stapleUse(r: Recipe, portions: number, scale: number): Amount[] {
  const merged = new Map<string, number>();
  for (const l of linesFor(r, portions, scale)) {
    if (isStaple(l.item)) merged.set(l.item, (merged.get(l.item) ?? 0) + l.qty);
  }
  return [...merged].map(([item, qty]) => ({ item, qty: cents(qty) })).filter((u) => u.qty > 0);
}

/**
 * What the next `days` days still need of each staple, from needs not yet cooked or
 * eaten (a cook missed earlier in the week still counts: it is still to make).
 */
export function staplesAhead(needs: Need[], today: string, days = 7): Map<string, number> {
  const last = addDays(today, days - 1);
  const out = new Map<string, number>();
  for (const n of needs) {
    if (!isStaple(n.item)) continue;
    const uses = n.at ?? [{ date: n.firstUse, qty: n.qty, use: "" }];
    const qty = uses.filter((u) => u.date <= last).reduce((t, u) => t + u.qty, 0);
    if (qty > 0) out.set(n.item, (out.get(n.item) ?? 0) + qty);
  }
  return out;
}

/**
 * Below this a counted staple is low: what the days ahead need of it, or about 15%
 * of a pack (the product you picked, or the usual one), whichever is more.
 */
export function lowBelow(item: Ingredient, product: Product | undefined, ahead: number): number {
  const pack = packInItemUnit(item, product?.packQty ?? item.pack.qty, product?.packUnit ?? item.pack.unit);
  return Math.max(ahead, LOW_SHARE * pack);
}

/**
 * What a cook or a meal takes of the cupboard's staples: from counted ones only, and
 * no more than each has, so what is recorded is what really came out and Undo puts
 * back no more. `low` is each staple it leaves below `lowBelow` that was "have";
 * `stock` is the kitchen after, for the next meal in a run.
 */
export function countDown(
  uses: Amount[],
  stock: StockRow[],
  ahead: Map<string, number>,
  products: Product[],
): { taken: Amount[]; low: string[]; stock: StockRow[] } {
  const rows = new Map(stock.map((r) => [r.item, { ...r }]));
  const taken: Amount[] = [];
  const low: string[] = [];
  for (const u of uses) {
    const item = INGREDIENTS.get(u.item);
    const row = rows.get(u.item);
    if (!item?.staple || !row || !counted(row)) continue;
    const qty = Math.min(cents(u.qty), row.qty);
    if (!(qty > 0)) continue;
    row.qty = cents(row.qty - qty);
    taken.push({ item: u.item, qty });
    const product = products.find((p) => p.item === u.item);
    if (row.status === "have" && row.qty < lowBelow(item, product, ahead.get(u.item) ?? 0)) {
      row.status = "low";
      low.push(u.item);
    }
  }
  return { taken, low, stock: [...rows.values()] };
}

/**
 * What unticking a meal puts back of its staples: on counted ones only, so a staple
 * nobody counted is never given an amount it did not have. It stays low if eating
 * it turned it low; a shop or the Cupboard says when there is more.
 */
export function putBack(uses: Amount[], stock: StockRow[]): Amount[] {
  return uses.filter((u) => counted(stock.find((r) => r.item === u.item)));
}

/**
 * A staple marked by hand in the Cupboard. "Have" or "out" on a counted one clears
 * its amount as well: the count no longer says what is there (more was bought, or
 * none is left), so it stops until a shop counts it in again. "Low" keeps it counting.
 * The mark it already has changes nothing.
 */
export function markByHand(
  row: Pick<StockRow, "item" | "qty" | "status"> | undefined,
  item: string,
  status: "have" | "low" | "out",
): StockChange {
  if (!row || row.status === status || status === "low" || !counted(row)) return { item, status };
  return { item, status, qty: 0 };
}
