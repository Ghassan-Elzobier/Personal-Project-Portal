// Meal combinations that buy nothing extra: the week's mains are chosen as a set,
// so dishes share packs and little is left over to go off.
//
// A week scores what the menu likes (its rank of each dish, with cuisines and meats
// spread out) less what it costs: the packs to buy after what's in the kitchen, plus
// fresh food left over that would go off before another week can use it. Long-life
// leftovers stay in the cupboard and cost nothing more. Small weeks are searched in
// full; bigger ones start from the menu's own picks and swap one dish at a time while
// the week gets better. The best few are then costed exactly, the way the shopping
// list will be, and a dish whose pack would be part-used grows by up to 15% to finish
// it. Same inputs, same week. Pure, so it is tested.

import { addDays } from "../dates/week.ts";
import type { FoodRules } from "./allergens.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { portionMacros } from "./nutrition.ts";
import {
  assign,
  cookScale,
  sizeCooks,
  type Cook,
  type Placement,
  type Routine,
  type StockBatch,
  type WeekPlan,
} from "./planner.ts";
import { mainProtein, recipe, type Recipe } from "./recipes.ts";
import {
  buildList,
  goodOn,
  linesFor,
  money,
  packInItemUnit,
  splitTrips,
  weekNeeds,
  type Product,
  type StockRow,
} from "./shopping.ts";
import type { Ranked } from "./suggest.ts";

// ------------------------------------------------------------------ the search

/** An ingredient as the shop sells it, and what the kitchen has of it. */
export type ComboItem = {
  key: string;
  /** One pack, in the unit dishes count in. */
  perPack: number;
  /** Pence for one pack. */
  pence: number;
  /** In the kitchen now. */
  have: number;
  /** A cupboard staple: one pack when it is out, never counted by the gram. */
  staple?: "in" | "out";
  /** Left over, it goes off before another week can use it. */
  perishable: boolean;
};

/** A dish that could fill one place in the week, and what it would use there. */
export type ComboDish = {
  key: string;
  score: number;
  cuisine: string;
  protein: string;
  explore: boolean;
  uses: { item: number; qty: number }[];
};

export type ComboProblem = {
  items: ComboItem[];
  /** What the rest of the week needs (breakfasts, shakes, weekend dinners), by item. */
  base: number[];
  /** The week's places in session order, and the dishes that may fill each. */
  places: { session: number; dishes: ComboDish[] }[];
  /** Points a pound is worth, against the menu's points for what you like. */
  perPound: number;
  /** Points each line on the list costs: fewer things to find, fewer aisles to wander. */
  perItem: number;
};

export type ComboCost = { pence: number; waste: number; items: number };
/** A week: the dish in each place (an index into that place's dishes), and how it scores. */
export type ComboChoice = ComboCost & { picks: number[]; score: number };

/** A dish's ingredients bought and left over, and the score so far, kept as dishes come and go. */
class Basket {
  readonly q: Float64Array;
  private readonly pc: Float64Array;
  private readonly wc: Float64Array;
  private readonly bc: Uint8Array;
  pence = 0;
  waste = 0;
  items = 0;
  liked = 0;
  explore = 0;
  private readonly cuisines = new Map<string, number>();
  private readonly proteins = new Map<string, number>();
  private readonly p: ComboProblem;

  constructor(p: ComboProblem) {
    this.p = p;
    const n = p.items.length;
    this.q = new Float64Array(n);
    this.pc = new Float64Array(n);
    this.wc = new Float64Array(n);
    this.bc = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.set(i, p.base[i] ?? 0);
  }

  // The search's inner loop: itemCost's arithmetic, without making an object each time.
  private set(i: number, q: number) {
    const it = this.p.items[i];
    this.pence -= this.pc[i];
    this.waste -= this.wc[i];
    this.items -= this.bc[i];
    this.q[i] = q;
    let pence = 0;
    let waste = 0;
    let buy = 0;
    if (it.staple) {
      if (q > 1e-9 && it.staple === "out") {
        pence = it.pence;
        buy = 1;
      }
    } else {
      const short = q - it.have;
      const packs = short > 1e-9 ? Math.max(1, Math.ceil(short / it.perPack - 0.02)) : 0;
      const left = it.have + packs * it.perPack - q;
      pence = packs * it.pence;
      buy = packs > 0 ? 1 : 0;
      if (it.perishable && left > 1e-9) waste = (left / it.perPack) * it.pence;
    }
    this.pc[i] = pence;
    this.wc[i] = waste;
    this.bc[i] = buy;
    this.pence += pence;
    this.waste += waste;
    this.items += buy;
  }

  add(d: ComboDish) {
    for (const u of d.uses) this.set(u.item, this.q[u.item] + u.qty);
    const c = this.cuisines.get(d.cuisine) ?? 0;
    const m = this.proteins.get(d.protein) ?? 0;
    this.liked += d.score - 2 * c - 1.5 * m;
    this.cuisines.set(d.cuisine, c + 1);
    this.proteins.set(d.protein, m + 1);
    if (d.explore) this.explore++;
  }

  remove(d: ComboDish) {
    const c = this.cuisines.get(d.cuisine)! - 1;
    const m = this.proteins.get(d.protein)! - 1;
    this.cuisines.set(d.cuisine, c);
    this.proteins.set(d.protein, m);
    this.liked -= d.score - 2 * c - 1.5 * m;
    if (d.explore) this.explore--;
    for (const u of d.uses) this.set(u.item, Math.max(0, this.q[u.item] - u.qty));
  }

  score(): number {
    return this.liked - (this.p.perPound * (this.pence + this.waste)) / 100 - this.p.perItem * this.items;
  }

  /** At most one dish to explore, and no more than `most` of a cuisine or a main meat. */
  fits(d: ComboDish, most: number): boolean {
    if (d.explore && this.explore >= 1) return false;
    return (this.cuisines.get(d.cuisine) ?? 0) < most && (this.proteins.get(d.protein) ?? 0) < most;
  }
}

/** One ingredient's packs and leftover value at a quantity the week needs. */
export function itemCost(it: ComboItem, q: number): { pence: number; waste: number; buy: boolean } {
  if (it.staple) return q > 1e-9 && it.staple === "out" ? { pence: it.pence, waste: 0, buy: true } : NOTHING;
  const short = q - it.have;
  // As the list rounds: a pack that falls 2% short still does.
  const packs = short > 1e-9 ? Math.max(1, Math.ceil(short / it.perPack - 0.02)) : 0;
  const left = it.have + packs * it.perPack - q;
  return {
    pence: packs * it.pence,
    waste: it.perishable && left > 1e-9 ? (left / it.perPack) * it.pence : 0,
    buy: packs > 0,
  };
}
const NOTHING = { pence: 0, waste: 0, buy: false };

/** About how many weeks a full search would look at. */
export function searchSize(p: ComboProblem): number {
  let size = 1;
  const sessions = [...new Set(p.places.map((x) => x.session))];
  for (const s of sessions) {
    const places = p.places.filter((x) => x.session === s);
    const n = Math.max(...places.map((x) => x.dishes.length));
    let ways = 1;
    for (let k = 0; k < places.length; k++) ways = (ways * (n - k)) / (k + 1);
    size *= Math.max(1, ways);
  }
  return size;
}

const FULL_SEARCH = 400_000;

/**
 * The best weeks by score, and the cheapest (packs plus waste), each list best first.
 * A week has at most one dish to explore, and never all its dishes (from three up)
 * from one cuisine or one main meat, unless nothing else fits; past that, the spread
 * is the menu's, a cost in points for each repeat. (Holding a four-dish week to two
 * of a meat cost far more: shared packs of chicken are what make a cheap week.) Every week is
 * searched when there are few enough; otherwise it starts from `start` (an index into
 * each place's dishes, or -1) and swaps one dish at a time while that helps.
 */
export function searchWeeks(
  p: ComboProblem,
  opts: { start?: number[]; keep?: number } = {},
): { best: ComboChoice[]; cheapest: ComboChoice[] } {
  const most = Math.max(2, p.places.length - 1);
  const found = search(p, most, opts.start, opts.keep ?? 6);
  return found.best.length ? found : search(p, Infinity, opts.start, opts.keep ?? 6);
}

function search(
  p: ComboProblem,
  most: number,
  start: number[] | undefined,
  keep: number,
): { best: ComboChoice[]; cheapest: ComboChoice[] } {
  const n = p.places.length;
  const best: ComboChoice[] = [];
  const cheapest: ComboChoice[] = [];
  const seen = new Set<string>();
  if (!n || p.places.some((x) => !x.dishes.length)) return { best, cheapest };
  const basket = new Basket(p);
  const picks = new Array<number>(n).fill(-1);
  const used = new Set<string>();
  const free = (d: ComboDish) => !used.has(d.key) && basket.fits(d, most);

  const consider = () => {
    const score = basket.score();
    const cost = basket.pence + basket.waste;
    const better = best.length < keep || score > best[best.length - 1].score + 1e-9;
    const cheaper = cheapest.length < keep || cost < costOf(cheapest[cheapest.length - 1]) - 1e-9;
    if (!better && !cheaper) return;
    const sig = picks.join(",");
    if (seen.has(sig)) return;
    seen.add(sig);
    const c: ComboChoice = { picks: [...picks], score, pence: basket.pence, waste: basket.waste, items: basket.items };
    if (better) insert(best, c, keep, (a, b) => b.score - a.score);
    if (cheaper) insert(cheapest, c, keep, (a, b) => costOf(a) - costOf(b));
  };

  if (searchSize(p) <= FULL_SEARCH) {
    // Every week. Within a session the dishes come in list order, so no week is counted twice.
    const order = p.places.map((x) => new Map(x.dishes.map((d, i) => [d.key, i])));
    const walk = (k: number) => {
      if (k === n) return consider();
      const place = p.places[k];
      const before = k > 0 && p.places[k - 1].session === place.session ? p.places[k - 1].dishes[picks[k - 1]] : null;
      const from = before ? (order[k].get(before.key) ?? -1) + 1 : 0;
      for (let d = from; d < place.dishes.length; d++) {
        const dish = place.dishes[d];
        if (!free(dish)) continue;
        used.add(dish.key);
        basket.add(dish);
        picks[k] = d;
        walk(k + 1);
        basket.remove(dish);
        used.delete(dish.key);
      }
      picks[k] = -1;
    };
    walk(0);
    return { best, cheapest };
  }

  // Too many to try: start from the given week and swap one dish at a time while it helps.
  for (let k = 0; k < n; k++) {
    const place = p.places[k];
    let d = start?.[k] ?? -1;
    if (d < 0 || !free(place.dishes[d])) d = place.dishes.findIndex(free);
    if (d < 0) return { best, cheapest };
    used.add(place.dishes[d].key);
    basket.add(place.dishes[d]);
    picks[k] = d;
  }
  consider();
  for (let round = 0; round < 60; round++) {
    let gain = 1e-9;
    let move: [number, number] | null = null;
    const now = basket.score();
    for (let k = 0; k < n; k++) {
      const place = p.places[k];
      const current = place.dishes[picks[k]];
      const was = picks[k];
      basket.remove(current);
      used.delete(current.key);
      for (let d = 0; d < place.dishes.length; d++) {
        const dish = place.dishes[d];
        if (d === was || !free(dish)) continue;
        basket.add(dish);
        picks[k] = d;
        consider();
        const g = basket.score() - now;
        if (g > gain) {
          gain = g;
          move = [k, d];
        }
        basket.remove(dish);
      }
      picks[k] = was;
      basket.add(current);
      used.add(current.key);
    }
    if (!move) break;
    const [k, d] = move;
    const place = p.places[k];
    basket.remove(place.dishes[picks[k]]);
    used.delete(place.dishes[picks[k]].key);
    basket.add(place.dishes[d]);
    used.add(place.dishes[d].key);
    picks[k] = d;
  }
  return { best, cheapest };
}

const costOf = (c: ComboCost) => c.pence + c.waste;

function insert<T>(list: T[], x: T, keep: number, cmp: (a: T, b: T) => number) {
  let i = list.length;
  while (i > 0 && cmp(x, list[i - 1]) < 0) i--;
  list.splice(i, 0, x);
  if (list.length > keep) list.pop();
}

// ------------------------------------------------------------------ the week

/** What the planner needs from the kitchen to cost a week. */
export type Kitchen = {
  stock: StockRow[];
  products: Product[];
  /** Cooked portions already in the fridge or freezer. */
  batches: StockBatch[];
  kcal: number;
  routine: Routine;
  rules: FoodRules;
};

/** A cook session to fill, and how many mains it makes. */
export type ComboSession = { date: string; start: number; minutes?: number | null; dishes: number };

/** A week's cost the way the shopping list will see it. */
export type WeekCost = {
  /** Packs to buy after what's in the kitchen, in pence. */
  pence: number;
  /** The part of that for cupboard staples, which last for weeks. */
  cupboard: number;
  /** Fresh food left over that goes off, in pence. */
  waste: number;
  /** Lines on the list (or lists). */
  items: number;
  /** Shops with something to buy. */
  trips: number;
  /** The week's planned kcal, for the price per 1,000 kcal. */
  kcal: number;
};

const LONG_LIFE_DAYS = 14;

/**
 * What one portion costs at a size (`scale` against the recipe as written): each
 * ingredient's share of its pack, at your product's price or a typical one. Shares,
 * not whole packs, so it compares recipes; the week's list is what you pay.
 */
export function portionCost(r: Recipe, products: Product[], scale = 1): number {
  let pence = 0;
  for (const l of linesFor(r, 1, scale)) {
    const item = INGREDIENTS.get(l.item);
    if (!item) continue;
    const product = products.find((p) => p.item === l.item);
    const perPack = packInItemUnit(item, product?.packQty ?? item.pack.qty, product?.packUnit ?? item.pack.unit);
    pence += (l.qty / perPack) * (product?.pence ?? item.pack.pence);
  }
  return Math.round(pence);
}

/** Points a pound is worth: about a star's worth for every £2. */
const PER_POUND = 1;
/** Asked for a cheaper week, money counts six times as much. */
const PER_POUND_CHEAPER = 6;
const PER_ITEM = 0.15;
/** Whole packs: a dish grows by at most this much to finish one. */
export const ROUND_MAX = 1.15;

/**
 * The kitchen as a week starting on `start` can use it: food already past its date
 * counts as neither in stock nor waste. Food that goes off during the week is the
 * list's to judge, use by use (`fromKitchen`).
 */
function goodFrom(k: Kitchen, start: string): Kitchen {
  return { ...k, stock: k.stock.filter((row) => goodOn(row, start)) };
}

function comboItem(key: string, k: Kitchen): ComboItem | null {
  const ing = INGREDIENTS.get(key);
  if (!ing) return null;
  const product = k.products.find((p) => p.item === key);
  const row = k.stock.find((s) => s.item === key);
  return {
    key,
    perPack: packInItemUnit(ing, product?.packQty ?? ing.pack.qty, product?.packUnit ?? ing.pack.unit),
    pence: product?.pence ?? ing.pack.pence,
    have: ing.staple ? 0 : Math.max(0, row?.qty ?? 0),
    ...(ing.staple ? { staple: row?.status === "have" ? ("in" as const) : ("out" as const) } : {}),
    perishable: !ing.staple && ing.storage === "fridge" && (ing.keeps ?? Infinity) < LONG_LIFE_DAYS,
  };
}

/**
 * The cost of a week as planned: sized and placed as the planner will, then shopped
 * for as the list will (one shop, or a fresh week's shops). Waste is fresh food left
 * at the end, bought or already in, that goes off.
 */
export function weekCost(plan: WeekPlan, kitchen: Kitchen): WeekCost {
  const k = goodFrom(kitchen, plan.start);
  const sized: WeekPlan = { ...plan, cooks: sizeCooks(plan, k.routine, k.kcal) };
  const placed = assign(sized, k.routine, k.batches, k.kcal);
  return costOfPlaced(sized, placed, k);
}

function costOfPlaced(plan: WeekPlan, placed: Placement[], k: Kitchen): WeekCost {
  // Meals before the plan was made are history: nothing is bought for them.
  const from = plan.createdOn;
  const needs = weekNeeds(plan, placed, from ? { from } : {});
  const lists =
    plan.mode === "fresh" && plan.trips?.length
      ? splitTrips(needs, plan.trips, k.stock, k.products).trips.map((t) =>
          buildList(
            t.needs,
            k.stock.filter((x) => INGREDIENTS.get(x.item)?.staple),
            k.products,
            k.rules,
            t.date,
          ),
        )
      : [buildList(needs, k.stock, k.products, k.rules, null)];
  const bought = new Map<string, number>();
  let pence = 0;
  let cupboard = 0;
  let items = 0;
  let trips = 0;
  for (const lines of lists) {
    const buying = lines.filter((l) => l.packs > 0);
    if (buying.length) trips++;
    items += buying.length;
    for (const l of buying) {
      pence += l.pence;
      if (l.item.staple) cupboard += l.pence;
      bought.set(
        l.item.key,
        (bought.get(l.item.key) ?? 0) + (l.item.staple ? 0 : l.packs * packInItemUnit(l.item, l.packQty, l.packUnit)),
      );
    }
  }
  const need = new Map(needs.map((n) => [n.item, n.qty]));
  let waste = 0;
  for (const key of new Set([...need.keys(), ...k.stock.filter((x) => x.qty > 0).map((x) => x.item)])) {
    const it = comboItem(key, k);
    if (!it?.perishable) continue;
    const left = it.have + (bought.get(key) ?? 0) - (need.get(key) ?? 0);
    if (left > 1e-9) waste += (left / it.perPack) * it.pence;
  }
  let kcal = 0;
  for (const p of placed) {
    const r = p.recipe ? recipe(p.recipe) : undefined;
    if (r && !(from && p.date < from)) kcal += portionMacros(r).kcal * p.scale;
  }
  return { pence, cupboard, waste: Math.round(waste), items, trips, kcal: Math.round(kcal) };
}

export type ComboWeek = WeekCost & {
  /** The week's mains, in session order, with why each was picked. */
  cooks: Cook[];
};

const daysUntil = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const weekdayOf = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * The week's mains, chosen together. `week` is the rest of the week (its breakfast
 * batch, daily meals, weekend dinners and shops); `greedy` is the menu's own picks per
 * session, the start for weeks too big to search in full. A fresh week's sessions take
 * dishes that fit their time and keep in the fridge for the days they feed. With
 * `cheaper`, money counts for much more. Also returns the cheapest week found, when it
 * saves at least 50p on the chosen one.
 */
export function planCombo(input: {
  week: WeekPlan;
  sessions: ComboSession[];
  ranked: Ranked[];
  greedy: Recipe[][];
  kitchen: Kitchen;
  cheaper?: boolean;
}): { week: ComboWeek; cheaper: ComboWeek | null } | null {
  const { week, sessions, ranked } = input;
  const k = goodFrom(input.kitchen, week.start);
  const fresh = week.mode === "fresh";
  const end = addDays(week.start, 7);

  // The dishes each session may take, and how it scores them.
  const allowed = sessions.map((s, i) => {
    if (!fresh) return ranked.map((r) => ({ r, score: r.score }));
    const covers = daysUntil(s.date, sessions[i + 1]?.date ?? end);
    const weeknight = weekdayOf(s.date) < 5;
    const inTime = ranked.filter((r) => !s.minutes || r.recipe.totalMin <= s.minutes);
    const safe = inTime.filter((r) => r.recipe.keeps.fridgeDays >= covers);
    // Nothing fits the time: the quickest few, rather than no cook at all.
    const pool = safe.length
      ? safe
      : inTime.length
        ? inTime
        : [...ranked].sort((a, b) => a.recipe.totalMin - b.recipe.totalMin).slice(0, 3);
    return pool.map((r) => ({ r, score: r.score - (weeknight ? r.recipe.activeMin / 20 : 0) }));
  });

  // Portions per place, from the menu's own week: they hardly depend on which dish it is.
  const mainsOf = (picks: Recipe[][]): Cook[] =>
    sessions.flatMap((s, i) =>
      (picks[i] ?? []).map((r) => ({
        id: `${s.date}-${r.key}`,
        recipe: r.key,
        date: s.date,
        start: s.start,
        portions: 0,
        scale: 1,
      })),
    );
  const withMains = (mains: Cook[]): WeekPlan => ({ ...week, cooks: [...mains, ...week.cooks] });
  const greedyPlan = withMains(mainsOf(input.greedy));
  const greedySized: WeekPlan = { ...greedyPlan, cooks: sizeCooks(greedyPlan, k.routine, k.kcal) };
  const placed = assign(greedySized, k.routine, k.batches, k.kcal);
  const places: { session: number; portions: number; greedy?: string }[] = [];
  sessions.forEach((s, i) => {
    const sized = greedySized.cooks.filter((c) => c.date === s.date && c.start === s.start && isMain(c));
    for (let d = 0; d < s.dishes; d++)
      places.push({ session: i, portions: sized[d]?.portions ?? 2, greedy: input.greedy[i]?.[d]?.key });
  });
  if (!places.length) return null;

  // The rest of the week's food, and every ingredient a dish could use.
  const baseNeeds = weekNeeds({ ...greedySized, cooks: greedySized.cooks.filter((c) => !isMain(c)) }, placed);
  // In a fresh week, food that would not keep from the first shop to the day it is
  // used is bought on the shop before that day, so it counts once per shop.
  const tripDates = fresh ? (week.trips ?? []).map((t) => t.date).sort() : [];
  const shopFor = (key: string, date: string) => {
    if (!tripDates.length || daysUntil(tripDates[0], date) <= (INGREDIENTS.get(key)?.keeps ?? Infinity)) return 0;
    return tripDates.reduce((at, d, i) => (d <= date ? i : at), 0);
  };
  const index = new Map<string, number>();
  const items: ComboItem[] = [];
  const indexOf = (key: string, shop: number) => {
    let i = index.get(`${key}#${shop}`);
    if (i === undefined) {
      const it = comboItem(key, k);
      if (!it) return -1;
      i = items.length;
      // What the kitchen has is used first, so it counts against the first shop.
      items.push(shop ? { ...it, have: 0 } : it);
      index.set(`${key}#${shop}`, i);
    }
    return i;
  };
  const base: number[] = [];
  for (const n of baseNeeds)
    for (const u of n.at ?? [{ date: n.firstUse, qty: n.qty, use: "" }]) {
      const i = indexOf(n.item, shopFor(n.item, u.date));
      if (i >= 0) base[i] = (base[i] ?? 0) + u.qty;
    }
  const problem: ComboProblem = {
    items,
    base,
    places: places.map((pl) => ({
      session: pl.session,
      dishes: allowed[pl.session].map(({ r, score }) => {
        const uses = new Map<number, number>();
        for (const l of linesFor(r.recipe, pl.portions, cookScale(r.recipe, k.kcal))) {
          const i = indexOf(l.item, shopFor(l.item, sessions[pl.session].date));
          if (i >= 0) uses.set(i, (uses.get(i) ?? 0) + l.qty);
        }
        return {
          key: r.recipe.key,
          score,
          cuisine: r.recipe.cuisine,
          protein: mainProtein(r.recipe),
          explore: r.recipe.tags.includes("explore"),
          uses: [...uses].map(([item, qty]) => ({ item, qty })),
        };
      }),
    })),
    perPound: input.cheaper ? PER_POUND_CHEAPER : PER_POUND,
    perItem: PER_ITEM,
  };
  for (let i = 0; i < items.length; i++) base[i] = base[i] ?? 0;

  const found = searchWeeks(problem, {
    start: problem.places.map((pl, i) => pl.dishes.findIndex((d) => d.key === places[i].greedy)),
  });
  if (!found.best.length) return null;

  // The best few, costed exactly: sized, placed and shopped for as the week will be.
  const liked = (picks: number[]) => {
    let s = 0;
    const chosen = picks.map((d, i) => problem.places[i].dishes[d]);
    chosen.forEach((d, i) => {
      s += d.score;
      for (const e of chosen.slice(0, i)) s -= (e.cuisine === d.cuisine ? 2 : 0) + (e.protein === d.protein ? 1.5 : 0);
    });
    return s;
  };
  const toPicks = (c: ComboChoice): Recipe[][] =>
    sessions.map((_, i) =>
      c.picks
        .map((d, at) => ({ at, d }))
        .filter(({ at }) => problem.places[at].session === i)
        .map(({ at, d }) => recipe(problem.places[at].dishes[d].key)!),
    );
  const candidates = new Map<string, { picks: Recipe[][]; cost: WeekCost; score: number }>();
  for (const c of [...found.best, ...found.cheapest]) {
    const sig = c.picks.join(",");
    if (candidates.has(sig)) continue;
    const picks = toPicks(c);
    const cost = weekCost(withMains(mainsOf(picks)), k);
    const later = fresh ? Math.max(0, cost.trips - 1) : 0;
    const score =
      liked(c.picks) - (problem.perPound * (cost.pence + cost.waste)) / 100 - PER_ITEM * cost.items - 0.5 * later;
    candidates.set(sig, { picks, cost, score });
  }
  const all = [...candidates.values()];
  const byCost = [...all].sort((a, b) => costOf(a.cost) - costOf(b.cost) || b.score - a.score);
  const chosen = input.cheaper ? byCost[0] : [...all].sort((a, b) => b.score - a.score)[0];

  const mains = roundToPacks(withMains(mainsOf(chosen.picks)), k, chosen.cost);
  const cheapest = byCost[0];
  const offer =
    !input.cheaper && cheapest !== chosen && costOf(mains.cost) - costOf(cheapest.cost) >= 50 ? cheapest : null;
  return {
    week: { ...mains.cost, cooks: explain(mains.cooks, ranked, k) },
    cheaper: offer ? { ...offer.cost, cooks: mainsOf(offer.picks) } : null,
  };
}

const isMain = (c: Cook) => recipe(c.recipe)?.meal === "main";

/**
 * Whole packs: a main that is the only user of a fresh pack with some left grows by
 * up to 15% to finish it (`Cook.round`), when the rest of what it needs more of is
 * left over too. A bigger portion suits a bulk; it is kept only when the week then
 * costs no more and wastes less. Returns the week's mains and what the week costs.
 */
export function roundToPacks(
  plan: WeekPlan,
  k: Kitchen,
  cost: WeekCost = weekCost(plan, k),
): { cooks: Cook[]; cost: WeekCost } {
  const sized: WeekPlan = { ...plan, cooks: sizeCooks(plan, k.routine, k.kcal) };
  const placed = assign(sized, k.routine, k.batches, k.kcal);
  const needs = weekNeeds(sized, placed);
  const mains = sized.cooks.filter(isMain);
  // Left over at the end of the week, by ingredient, as the list buys it.
  const left = new Map<string, number>();
  const list = buildList(needs, k.stock, k.products, k.rules, null);
  for (const l of list) if (!l.item.staple) left.set(l.item.key, l.spare);
  const usesOf = (c: Cook) => {
    const m = new Map<string, number>();
    for (const l of linesFor(recipe(c.recipe)!, c.portions, c.scale)) m.set(l.item, (m.get(l.item) ?? 0) + l.qty);
    return m;
  };
  const users = new Map<string, number>();
  for (const n of needs) users.set(n.item, n.uses.length);
  const round = new Map<string, number>();
  for (const c of mains) {
    const uses = usesOf(c);
    const options = [...uses]
      .map(([item, qty]) => ({ item, qty, it: comboItem(item, k) }))
      .filter((o) => o.it?.perishable && users.get(o.item) === 1 && (left.get(o.item) ?? 0) > 1e-6 && o.qty > 0)
      .map((o) => ({
        ...o,
        f: (o.qty + left.get(o.item)!) / o.qty,
        value: (left.get(o.item)! / o.it!.perPack) * o.it!.pence,
      }))
      .filter((o) => o.f > 1 + 1e-6 && o.f <= ROUND_MAX)
      .sort((a, b) => b.value - a.value);
    for (const o of options) {
      const fits = [...uses].every(([item, qty]) => {
        if (item === o.item || INGREDIENTS.get(item)?.staple) return true;
        return (left.get(item) ?? 0) + 1e-6 >= (o.f - 1) * qty;
      });
      if (!fits) continue;
      for (const [item, qty] of uses) if (left.has(item)) left.set(item, left.get(item)! - (o.f - 1) * qty);
      round.set(c.id, Math.round(o.f * 1000) / 1000);
      break;
    }
  }
  if (!round.size) return { cooks: plan.cooks.filter(isMain), cost };
  const rounded: WeekPlan = {
    ...plan,
    cooks: plan.cooks.map((c) => (round.has(c.id) ? { ...c, round: round.get(c.id) } : c)),
  };
  const after = weekCost(rounded, k);
  return after.pence <= cost.pence && after.waste < cost.waste
    ? { cooks: rounded.cooks.filter(isMain), cost: after }
    : { cooks: plan.cooks.filter(isMain), cost };
}

/** Why each main is in the week: a bigger portion to finish a pack, food shared, food used up, or the menu's reason. */
function explain(mains: Cook[], ranked: Ranked[], k: Kitchen): Cook[] {
  const name = (key: string) => (INGREDIENTS.get(key)?.name ?? key).toLowerCase();
  const fresh = (c: Cook) =>
    new Set(
      recipe(c.recipe)!
        .lines.map((l) => l.item)
        .filter((item) => comboItem(item, k)?.perishable),
    );
  return mains.map((c) => {
    const why: string[] = [];
    const r = recipe(c.recipe)!;
    if (c.round && c.round > 1) {
      const main = r.lines.find((l) => comboItem(l.item, k)?.perishable);
      why.push(
        `Portions ${Math.round((c.round - 1) * 100)}% bigger to finish the ${name(main?.item ?? r.lines[0].item)}`,
      );
    }
    const mine = fresh(c);
    let partner: { cook: Cook; shared: string[] } | null = null;
    for (const o of mains) {
      if (o === c || o.recipe === c.recipe) continue;
      const shared = [...fresh(o)].filter((x) => mine.has(x));
      if (shared.length > (partner?.shared.length ?? 0)) partner = { cook: o, shared };
    }
    if (partner)
      why.push(
        `Shares the ${partner.shared.slice(0, 2).map(name).join(" and ")} with ${recipe(partner.cook.recipe)!.name}`,
      );
    const have = r.lines.find((l) => {
      const ing = INGREDIENTS.get(l.item);
      return ing && !ing.staple && (k.stock.find((s) => s.item === l.item)?.qty ?? 0) > 0;
    });
    if (have) why.push(`Uses the ${name(have.item)} you have`);
    const reason = ranked.find((x) => x.recipe.key === c.recipe)?.reasons[0];
    if (reason) why.push(reason);
    // Nothing shared or used up: what a portion costs is why it is good value.
    if (!why.length)
      why.push(`About ${money(portionCost(r, k.products, cookScale(r, k.kcal) * (c.round ?? 1)))} a portion`);
    return { ...c, why: [...new Set(why)].slice(0, 2) };
  });
}
