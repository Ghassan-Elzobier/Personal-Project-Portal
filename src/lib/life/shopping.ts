// From a meal week to a Sainsbury's basket, and back into the kitchen.
//
// Needs come from the week's cooks and daily meals at their portion sizes. What
// is already in the kitchen comes off, and the rest rounds up to whole packs of
// the product you picked (or a typical pack until you pick one). Fresh food that
// would pass its life before the cook it is for is marked to freeze on arrival.
// Cooking takes ingredients out of stock and puts portions in. Pure, so it is tested.

import { addDays } from "../dates/week.ts";
import { labelChecks, type FoodRules, type Tag } from "./allergens.ts";
import {
  fromGrams,
  INGREDIENTS,
  sainsburysSearch,
  toGrams,
  type Aisle,
  type Ingredient,
  type Unit,
} from "./ingredients.ts";
import { packProblem } from "./pack.ts";
import type { Placement, WeekPlan } from "./planner.ts";
import { recipe, type Recipe } from "./recipes.ts";

export type Product = {
  item: string;
  url: string;
  name: string;
  packQty: number;
  packUnit: Unit;
  pence: number | null;
  /** Allergen tags you confirmed are absent from this product's label. */
  checked: Tag[];
};

export type StockRow = {
  item: string;
  /** In the ingredient's own unit. */
  qty: number;
  /** For staples, which are not counted. */
  status: "have" | "low" | "out" | null;
  /** Fresh food: the last day it is good. */
  goodUntil: string | null;
};

/** One use of an ingredient: the day, how much, and the dish it is for. */
export type Use = { date: string; qty: number; use: string };

export type Need = {
  item: string;
  qty: number;
  firstUse: string;
  uses: string[];
  /** Each use on its own, in the order they were added. */
  at?: Use[];
};

/** Ingredients for one batch of a recipe at a portion count and size. */
export function linesFor(r: Recipe, portions: number, scale: number): { item: string; qty: number }[] {
  const k = (portions / r.portions) * scale;
  return r.lines.map((l) => {
    const ing = INGREDIENTS.get(l.item);
    const qty = ing ? fromGrams(ing, toGrams(ing, l.qty, l.unit)) : l.qty;
    return { item: l.item, qty: qty * k };
  });
}

/**
 * Everything the week's food still needs, by ingredient. Cooks already done and
 * meals already eaten have taken their share out of stock, so they are skipped;
 * so are daily meals on days gone by.
 */
export function weekNeeds(
  plan: WeekPlan,
  placements: Placement[],
  done: { cooked?: Set<string>; eaten?: Set<string>; from?: string } = {},
): Need[] {
  const out = new Map<string, Need>();
  const put = (item: string, qty: number, date: string, use: string) => {
    const n = out.get(item) ?? { item, qty: 0, firstUse: date, uses: [], at: [] };
    n.qty += qty;
    if (date < n.firstUse) n.firstUse = date;
    if (!n.uses.includes(use)) n.uses.push(use);
    n.at!.push({ date, qty, use });
    out.set(item, n);
  };
  for (const c of plan.cooks) {
    const r = recipe(c.recipe);
    if (!r || done.cooked?.has(c.id)) continue;
    for (const l of linesFor(r, c.portions, c.scale)) put(l.item, l.qty, c.date, r.name);
  }
  for (const p of placements) {
    if ((p.source !== "daily" && p.source !== "fresh") || !p.recipe) continue;
    if (done.eaten?.has(p.id) || (done.from && p.date < done.from)) continue;
    const r = recipe(p.recipe);
    if (!r) continue;
    for (const l of linesFor(r, 1, p.scale)) put(l.item, l.qty, p.date, r.name);
  }
  return [...out.values()];
}

export type ListLine = {
  item: Ingredient;
  need: number;
  have: number;
  /** Packs to buy, 0 when the kitchen has enough. */
  packs: number;
  packQty: number;
  packUnit: Unit;
  /** Pence for the packs, from your product's price or the typical one. */
  pence: number;
  priced: "yours" | "estimate";
  /** What will be left over after the week, in the ingredient's unit. */
  spare: number;
  link: string;
  product: Product | null;
  /** Label checks not yet confirmed for the product. */
  checks: Tag[];
  firstUse: string;
  freezeOnArrival: boolean;
  uses: string[];
};

/** The pack a product holds, or the usual pack when it was saved in a unit the ingredient can't count in. */
function usablePack(item: Ingredient, product: Product | null | undefined): { qty: number; unit: Unit } {
  if (!product || packProblem(item, product.packQty, product.packUnit)) return item.pack;
  return { qty: product.packQty, unit: product.packUnit };
}

/** Pack contents in the ingredient's own unit. */
export function packInItemUnit(item: Ingredient, packQty: number, packUnit: Unit): number {
  const pack = packProblem(item, packQty, packUnit) ? item.pack : { qty: packQty, unit: packUnit };
  if (pack.unit === item.unit) return pack.qty;
  return fromGrams(item, toGrams(item, pack.qty, pack.unit));
}

export function buildList(
  needs: Need[],
  stock: StockRow[],
  products: Product[],
  rules: FoodRules,
  deliveredOn: string | null,
): ListLine[] {
  const stockOf = new Map(stock.map((s) => [s.item, s]));
  const productOf = new Map(products.map((p) => [p.item, p]));
  const lines: ListLine[] = [];
  for (const n of needs) {
    const item = INGREDIENTS.get(n.item);
    if (!item) continue;
    const s = stockOf.get(n.item);
    const product = productOf.get(n.item) ?? null;
    const { qty: packQty, unit: packUnit } = usablePack(item, product);
    const perPack = packInItemUnit(item, packQty, packUnit);
    let have: number;
    let packs: number;
    if (item.staple) {
      have = s?.status === "have" ? n.qty : 0;
      packs = s?.status === "have" ? 0 : 1;
    } else {
      have = Math.max(0, s?.qty ?? 0);
      const short = n.qty - have;
      packs = short > 0 ? Math.max(1, Math.ceil(short / perPack - 0.02)) : 0;
    }
    const unitPence = product?.pence ?? item.pack.pence;
    const keepsDays = item.keeps ?? Infinity;
    lines.push({
      item,
      need: n.qty,
      have,
      packs,
      packQty,
      packUnit,
      pence: packs * unitPence,
      priced: product?.pence != null ? "yours" : "estimate",
      spare: item.staple ? 0 : Math.max(0, have + packs * perPack - n.qty),
      link: product?.url ?? sainsburysSearch(item.search),
      product,
      checks: labelChecks(rules, item.watch).filter((t) => !product?.checked.includes(t)),
      firstUse: n.firstUse,
      freezeOnArrival: Boolean(
        packs > 0 && deliveredOn && item.storage === "fridge" && dayGap(deliveredOn, n.firstUse) > keepsDays,
      ),
      uses: n.uses,
    });
  }
  return lines.sort(
    (a, b) => AISLES.indexOf(a.item.aisle) - AISLES.indexOf(b.item.aisle) || a.item.name.localeCompare(b.item.name),
  );
}

/** Food that keeps this long is bought on the first shop, so later shops stay small. */
const LONG_LIFE_DAYS = 14;

export type TripNeeds = {
  id: string;
  date: string;
  needs: Need[];
  /** Items wanted before this shop happens: use what's in, or shop sooner. */
  early: string[];
};

/**
 * A fresh week's shopping split across its shops, so each buys only what the days
 * until the next one need. In order:
 *
 * - The kitchen comes off first, oldest use first, while the stock is in date.
 * - Each remaining use goes to the last shop on or before its day.
 * - It moves to an earlier shop when a pack bought then keeps until the later use
 *   and that saves a pack (peppers for Monday and Friday: one pack on Sunday), and
 *   always for food that keeps for weeks (onions, pasta, tins).
 * - Staples go on the first shop; `buildList` buys them only when low or out.
 *
 * A use before the first shop goes on the first shop, flagged as early. Pure, so it is tested.
 */
export function splitTrips(
  needs: Need[],
  trips: { id: string; date: string }[],
  stock: StockRow[],
  products: Product[],
): { trips: TripNeeds[]; covered: string[] } {
  const out: TripNeeds[] = [...trips]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({ id: t.id, date: t.date, needs: [], early: [] }));
  const covered: string[] = [];
  if (!out.length) return { trips: out, covered };
  const stockOf = new Map(stock.map((x) => [x.item, x]));
  const productOf = new Map(products.map((x) => [x.item, x]));
  const tripFor = (date: string) => out.reduce((at, t, i) => (t.date <= date ? i : at), 0);

  for (const n of needs) {
    const item = INGREDIENTS.get(n.item);
    if (!item) continue;
    if (item.staple) {
      out[0].needs.push(n);
      continue;
    }
    const kept = stockOf.get(n.item);
    let have = Math.max(0, kept?.qty ?? 0);
    const left: Use[] = [];
    const uses = [...(n.at ?? [{ date: n.firstUse, qty: n.qty, use: n.uses[0] ?? "" }])].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (const u of uses) {
      const usable = !kept?.goodUntil || u.date <= kept.goodUntil ? have : 0;
      const take = Math.min(usable, u.qty);
      have -= take;
      if (u.qty - take > 1e-6) left.push({ ...u, qty: u.qty - take });
    }
    if (!left.length) {
      covered.push(n.item);
      continue;
    }
    const product = productOf.get(n.item);
    const perPack = packInItemUnit(item, product?.packQty ?? item.pack.qty, product?.packUnit ?? item.pack.unit);
    const packs = (us: Use[]) => Math.max(1, Math.ceil(us.reduce((t, u) => t + u.qty, 0) / perPack - 0.02));
    const keeps = item.keeps ?? Infinity;

    const groups: { trip: number; uses: Use[] }[] = [];
    for (const u of left) {
      const t = tripFor(u.date);
      const g = groups[groups.length - 1];
      if (g && g.trip === t) g.uses.push(u);
      else groups.push({ trip: t, uses: [u] });
    }
    const merged: typeof groups = [];
    for (const g of groups) {
      const a = merged[merged.length - 1];
      if (a) {
        const inDate = dayGap(out[a.trip].date, g.uses[g.uses.length - 1].date) <= keeps;
        const saves = packs([...a.uses, ...g.uses]) < packs(a.uses) + packs(g.uses);
        if (inDate && (saves || keeps >= LONG_LIFE_DAYS)) {
          a.uses.push(...g.uses);
          continue;
        }
      }
      merged.push({ trip: g.trip, uses: [...g.uses] });
    }
    // Food that keeps for weeks moves to the first shop, so the later ones stay small.
    const head = merged[0];
    if (keeps >= LONG_LIFE_DAYS && head.trip > 0 && dayGap(out[0].date, head.uses[head.uses.length - 1].date) <= keeps)
      head.trip = 0;
    for (const g of merged) {
      const t = out[g.trip];
      t.needs.push({
        item: n.item,
        qty: g.uses.reduce((sum, u) => sum + u.qty, 0),
        firstUse: g.uses[0].date,
        uses: [...new Set(g.uses.map((u) => u.use))],
        at: g.uses,
      });
      if (g.uses[0].date < t.date) t.early.push(n.item);
    }
  }
  return { trips: out, covered };
}

/**
 * Items a shop didn't have move to the next shop's list, merged with anything it
 * buys of the same, and flagged early when they're wanted before it. With no shop
 * after, they stay with nowhere to go (`to: null`), for a top-up. In date order, so
 * an item missing twice moves twice. Pure, so it is tested.
 */
export function carryMissing(
  trips: TripNeeds[],
  missing: Record<string, string[]>,
): { trips: TripNeeds[]; moved: { from: string; to: string | null; need: Need }[] } {
  const out = trips.map((t) => ({ ...t, needs: [...t.needs], early: [...t.early] }));
  const moved: { from: string; to: string | null; need: Need }[] = [];
  out.forEach((t, i) => {
    const gone = new Set(missing[t.id] ?? []);
    if (!gone.size) return;
    const next = out[i + 1];
    for (const n of t.needs.filter((x) => gone.has(x.item))) {
      t.needs = t.needs.filter((x) => x !== n);
      t.early = t.early.filter((x) => x !== n.item);
      moved.push({ from: t.id, to: next?.id ?? null, need: n });
      if (!next) continue;
      const there = next.needs.find((x) => x.item === n.item);
      if (there) {
        there.qty += n.qty;
        there.firstUse = n.firstUse < there.firstUse ? n.firstUse : there.firstUse;
        there.uses = [...new Set([...there.uses, ...n.uses])];
        there.at = [...(n.at ?? []), ...(there.at ?? [])];
      } else next.needs.push({ ...n });
      if (n.firstUse < next.date && !next.early.includes(n.item)) next.early.push(n.item);
    }
  });
  return { trips: out, moved };
}

export const AISLES: Aisle[] = [
  "Fruit & veg",
  "Meat & fish",
  "Dairy",
  "Bakery",
  "Pasta, rice & grains",
  "Tins & jars",
  "Sauces & oils",
  "Herbs & spices",
  "Baking",
  "Frozen",
  "Supplements",
];

function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * What the shop costs, split into the week's food and the cupboard: staples
 * (spices, oil, flour, protein powder) last for weeks, so they are a stock-up,
 * not part of what a week of eating costs.
 */
export function listTotal(lines: ListLine[]): {
  pence: number;
  estimated: boolean;
  packs: number;
  food: number;
  cupboard: number;
} {
  const buying = lines.filter((l) => l.packs > 0);
  const cupboard = buying.filter((l) => l.item.staple).reduce((s, l) => s + l.pence, 0);
  const pence = buying.reduce((s, l) => s + l.pence, 0);
  return {
    pence,
    estimated: buying.some((l) => l.priced === "estimate"),
    packs: buying.reduce((s, l) => s + l.packs, 0),
    food: pence - cupboard,
    cupboard,
  };
}

/** Stock changes when a delivery's ticked lines arrive. */
export function delivery(
  lines: ListLine[],
  got: string[],
  deliveredOn: string,
): { item: string; add: number; status: "have" | null; goodUntil: string | null }[] {
  return lines
    .filter((l) => l.packs > 0 && got.includes(l.item.key))
    .map((l) => ({
      item: l.item.key,
      add: l.item.staple ? 0 : l.packs * packInItemUnit(l.item, l.packQty, l.packUnit),
      status: l.item.staple ? ("have" as const) : null,
      goodUntil: l.item.keeps && !l.freezeOnArrival ? addDays(deliveredOn, l.item.keeps) : null,
    }));
}

/**
 * What Undo needs to put the kitchen back as it was before a shop: the amounts the
 * shop added, and each cupboard staple's status before it was marked "have".
 */
export function undoOf(
  changes: { item: string; add: number; status: "have" | null }[],
  stock: StockRow[],
): { added: { item: string; qty: number }[]; restore: { item: string; status: StockRow["status"] }[] } {
  const before = (item: string) => stock.find((s) => s.item === item)?.status ?? null;
  return {
    added: changes.filter((c) => c.add > 0).map((c) => ({ item: c.item, qty: c.add })),
    restore: changes
      .filter((c) => c.status && before(c.item) !== c.status)
      .map((c) => ({ item: c.item, status: before(c.item) })),
  };
}

/** What a cook takes out of the kitchen. Staples are not counted. */
export function cookUse(r: Recipe, portions: number, scale: number): { item: string; qty: number }[] {
  const merged = new Map<string, number>();
  for (const l of linesFor(r, portions, scale)) {
    if (INGREDIENTS.get(l.item)?.staple) continue;
    merged.set(l.item, (merged.get(l.item) ?? 0) + l.qty);
  }
  return [...merged].map(([item, qty]) => ({ item, qty: Math.round(qty * 10) / 10 }));
}

/** Fresh food close to its date, soonest first. */
export function soonToUse(stock: StockRow[], today: string, withinDays = 2): StockRow[] {
  return stock
    .filter((s) => s.qty > 0 && s.goodUntil && dayGap(today, s.goodUntil) <= withinDays)
    .sort((a, b) => (a.goodUntil ?? "").localeCompare(b.goodUntil ?? ""));
}

/** "1.2 kg", "3", "250 ml": a quantity for people. */
export function amount(item: Ingredient, qty: number): string {
  if (item.unit === "each") {
    const n = Math.round(qty * 2) / 2;
    return `${n % 1 === 0 ? n : n.toFixed(1)}`;
  }
  const unit = item.unit;
  if (qty >= 1000) return `${(Math.round(qty / 100) / 10).toString()} ${unit === "g" ? "kg" : "l"}`;
  if (qty >= 100) return `${Math.round(qty / 10) * 10} ${unit}`;
  if (qty >= 10) return `${Math.round(qty / 5) * 5} ${unit}`;
  return `${Math.max(1, Math.round(qty))} ${unit}`;
}

export function packLabel(qty: number, unit: Unit): string {
  if (unit === "each") return `${qty}`;
  if (qty >= 1000 && qty % 100 === 0) return `${qty / 1000} ${unit === "g" ? "kg" : "l"}`;
  return `${qty} ${unit}`;
}

/** Pence as "£4.25". */
export function money(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
