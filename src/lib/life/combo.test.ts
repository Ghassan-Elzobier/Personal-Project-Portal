import { test } from "node:test";
import assert from "node:assert/strict";
import type { FoodRules } from "./allergens.ts";
import {
  itemCost,
  portionCost,
  roundToPacks,
  ROUND_MAX,
  searchSize,
  searchWeeks,
  weekCost,
  type ComboDish,
  type ComboItem,
  type ComboProblem,
  type Kitchen,
} from "./combo.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { verdict } from "./nutrition.ts";
import { assign, cookScale, reminders, sizeCooks, type WeekMode, type WeekPlan } from "./planner.ts";
import { DEFAULT_PROFILE, plannerRoutine, type LifeProfile } from "./profile.ts";
import { recipe } from "./recipes.ts";
import type { Product } from "./shopping.ts";
import { suggestWeek } from "./suggest.ts";

// ------------------------------------------------------------------ the search, on made-up food

const item = (key: string, o: Partial<ComboItem> = {}): ComboItem => ({
  key,
  perPack: 100,
  pence: 100,
  have: 0,
  perishable: true,
  ...o,
});
const dish = (key: string, uses: [number, number][], o: Partial<ComboDish> = {}): ComboDish => ({
  key,
  score: 0,
  cuisine: `cuisine-${key}`,
  protein: `meat-${key}`,
  explore: false,
  uses: uses.map(([i, qty]) => ({ item: i, qty })),
  ...o,
});
/** One session with `places` dishes to choose, from the same list. */
const oneSession = (items: ComboItem[], dishes: ComboDish[], places: number): ComboProblem => ({
  items,
  base: items.map(() => 0),
  places: Array.from({ length: places }, () => ({ session: 0, dishes })),
  perPound: 1,
  perItem: 0.15,
});
const keysOf = (p: ComboProblem, picks: number[]) => picks.map((d, i) => p.places[i].dishes[d].key).sort();

test("two dishes sharing a bunch of herbs beat two that each leave half a bunch to go off", () => {
  const items = [item("parsley"), item("mint"), item("basil")];
  const p = oneSession(
    items,
    [dish("A", [[0, 50]]), dish("B", [[0, 50]]), dish("C", [[1, 50]]), dish("D", [[2, 50]])],
    2,
  );
  const { best, cheapest } = searchWeeks(p);
  assert.deepEqual(keysOf(p, best[0].picks), ["A", "B"]);
  assert.equal(best[0].pence, 100, "one bunch");
  assert.equal(best[0].waste, 0);
  assert.deepEqual(keysOf(p, cheapest[0].picks), ["A", "B"]);
  // Any other pair buys two bunches and bins half of each.
  const other = best.find((c) => keysOf(p, c.picks).join() === "A,C")!;
  assert.equal(other.pence, 200);
  assert.equal(other.waste, 100);
});

test("a dish you like much more still wins over a small saving, and the cheapest week is kept too", () => {
  const items = [item("parsley"), item("mint"), item("basil")];
  const p = oneSession(
    items,
    [dish("A", [[0, 50]]), dish("B", [[0, 50]]), dish("C", [[1, 50]], { score: 5 }), dish("D", [[2, 50]])],
    2,
  );
  const { best, cheapest } = searchWeeks(p);
  assert.ok(keysOf(p, best[0].picks).includes("C"), "five points beat £2");
  assert.deepEqual(keysOf(p, cheapest[0].picks), ["A", "B"]);
});

test("a week has at most one dish to explore", () => {
  const items = [item("x")];
  const p = oneSession(
    items,
    [
      dish("E1", [[0, 10]], { explore: true, score: 10 }),
      dish("E2", [[0, 10]], { explore: true, score: 10 }),
      dish("N1", [[0, 10]]),
      dish("N2", [[0, 10]]),
    ],
    2,
  );
  for (const c of searchWeeks(p).best)
    assert.ok(c.picks.filter((d, i) => p.places[i].dishes[d].explore).length <= 1, keysOf(p, c.picks).join());
});

test("never every dish from one meat, unless nothing else fits", () => {
  const items = [item("chicken", { perishable: false })];
  const chicken = (key: string) => dish(key, [[0, 100]], { protein: "chicken", score: 5 });
  const p = oneSession(
    items,
    [chicken("C1"), chicken("C2"), chicken("C3"), dish("P1", [[0, 100]], { protein: "pork" })],
    3,
  );
  for (const c of searchWeeks(p).best)
    assert.ok(c.picks.filter((d, i) => p.places[i].dishes[d].protein === "chicken").length <= 2);
  const onlyChicken = oneSession(items, [chicken("C1"), chicken("C2"), chicken("C3")], 3);
  assert.equal(searchWeeks(onlyChicken).best.length, 1, "three chicken dishes when there is nothing else");
});

test("a pack costs what it costs: the kitchen first, whole packs after, staples only when out", () => {
  const herbs = item("parsley");
  assert.deepEqual(itemCost(herbs, 0), { pence: 0, waste: 0, buy: false });
  assert.deepEqual(itemCost(herbs, 150), { pence: 200, waste: 50, buy: true }, "two bunches, half of one left");
  assert.deepEqual(itemCost(herbs, 101), { pence: 100, waste: 0, buy: true }, "a pack 1% short still does");
  assert.deepEqual(itemCost(item("parsley", { have: 150 }), 100), { pence: 0, waste: 50, buy: false });
  assert.deepEqual(itemCost(item("rice", { perishable: false }), 150), { pence: 200, waste: 0, buy: true });
  assert.deepEqual(itemCost(item("salt", { staple: "out" }), 5), { pence: 100, waste: 0, buy: true });
  assert.deepEqual(itemCost(item("salt", { staple: "in" }), 5), { pence: 0, waste: 0, buy: false });
});

/** Thirty made-up dishes over forty made-up ingredients, the same every time. */
function library(places: { session: number }[]): ComboProblem {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const items = Array.from({ length: 40 }, (_, i) =>
    item(`i${i}`, {
      perPack: 200 + Math.floor(next() * 800),
      pence: 50 + Math.floor(next() * 400),
      perishable: i % 3 !== 0,
    }),
  );
  const dishes = Array.from({ length: 30 }, (_, d) =>
    dish(
      `d${d}`,
      Array.from({ length: 6 }, () => [Math.floor(next() * 40), 20 + Math.floor(next() * 300)] as [number, number]),
      {
        score: Math.floor(next() * 8) - 2,
        cuisine: `c${d % 6}`,
        protein: `m${d % 5}`,
        explore: d % 7 === 0,
      },
    ),
  );
  return { items, base: items.map(() => 0), places: places.map((x) => ({ ...x, dishes })), perPound: 1, perItem: 0.15 };
}

test("every one of the 27,405 four-dish weeks from thirty dishes is tried in well under a second", () => {
  const p = library([{ session: 0 }, { session: 0 }, { session: 0 }, { session: 0 }]);
  assert.equal(searchSize(p), 27_405);
  const began = performance.now();
  const { best } = searchWeeks(p);
  const took = performance.now() - began;
  assert.ok(took < 1000, `${Math.round(took)} ms`);
  assert.equal(new Set(keysOf(p, best[0].picks)).size, 4);
});

test("the same inputs give the same weeks", () => {
  const p = library([{ session: 0 }, { session: 0 }, { session: 1 }, { session: 1 }]);
  assert.deepEqual(searchWeeks(p), searchWeeks(p));
});

test("a week too big to try in full starts from the menu's picks and only gets better", () => {
  const sessions = [0, 0, 1, 1, 2, 2].map((session) => ({ session }));
  const p = library(sessions);
  assert.ok(searchSize(p) > 1_000_000);
  const start = [1, 2, 3, 4, 5, 6];
  const began = performance.now();
  const { best } = searchWeeks(p, { start });
  assert.ok(performance.now() - began < 1000);
  // The start week on its own, scored the same way.
  const alone: ComboProblem = { ...p, places: p.places.map((pl, i) => ({ ...pl, dishes: [pl.dishes[start[i]]] })) };
  const was = searchWeeks(alone).best[0];
  assert.ok(best[0].score >= was.score - 1e-9, `${best[0].score} against ${was.score}`);
  assert.equal(new Set(keysOf(p, best[0].picks)).size, 6);
});

// ------------------------------------------------------------------ the week, on the real recipes

// A made-up owner: set up, with the default routine, and nothing in the kitchen.
const profile: LifeProfile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const START = "2026-11-22";
const kitchenOf = (p: LifeProfile, o: Partial<Kitchen> = {}): Kitchen => ({
  stock: [],
  products: [],
  batches: [],
  kcal: 2900,
  routine: plannerRoutine(p),
  rules: p.food,
  ...o,
});
const week = (mode: WeekMode, p = profile, o: { cheaper?: boolean } = {}) =>
  suggestWeek(p, START, [], {}, {}, START, mode, { ...kitchenOf(p), ...o });
const mains = (plan: WeekPlan) => plan.cooks.filter((c) => recipe(c.recipe)?.meal === "main");

test("the combination costs less and lists fewer things than the menu's own picks", () => {
  for (const mode of ["batch", "fresh"] as const) {
    const k = kitchenOf(profile);
    const before = weekCost(suggestWeek(profile, START, [], {}, {}, START, mode), k);
    const plan = week(mode);
    const after = weekCost(plan, k);
    assert.ok(after.pence + after.waste < before.pence + before.waste, `${mode}: ${JSON.stringify({ before, after })}`);
    assert.ok(after.items <= before.items, `${mode}: ${after.items} items against ${before.items}`);
    const { cheaper, ...saved } = plan.cost!;
    assert.deepEqual(saved, after, "the plan says what it costs");
    if (cheaper !== undefined) assert.ok(cheaper <= after.pence + after.waste - 50);
  }
});

test("asked for a cheaper week, the week costs no more than the best-value one", () => {
  for (const mode of ["batch", "fresh"] as const) {
    const k = kitchenOf(profile);
    const value = weekCost(week(mode), k);
    const cheap = week(mode, profile, { cheaper: true });
    const cost = weekCost(cheap, k);
    assert.ok(cost.pence + cost.waste <= value.pence + value.waste, mode);
    assert.equal(cheap.cost?.cheaper, undefined, "nothing cheaper to offer");
  }
});

test("the food rules are never broken", () => {
  const rules: FoodRules = {
    rules: [
      { tag: "fish", level: "avoid" },
      { tag: "sesame", level: "avoid" },
      { tag: "egg", level: "avoid", allowForms: ["baked"] },
    ],
    mayContainOk: [],
    dislikes: [],
    avoidTraits: [],
  };
  const careful: LifeProfile = { ...profile, food: rules };
  for (const mode of ["batch", "fresh"] as const)
    for (const cheaper of [false, true]) {
      const plan = week(mode, careful, { cheaper });
      const keys = [...plan.cooks.map((c) => c.recipe), plan.breakfast, ...(plan.shakes ?? [])].filter(Boolean);
      for (const key of keys) assert.ok(verdict(recipe(key)!, rules).ok, `${mode} ${key}`);
    }
});

test("a fresh week keeps its rules: one dish per session, in its time, and nothing frozen", () => {
  const plan = week("fresh");
  const sized = { ...plan, cooks: sizeCooks(plan, plannerRoutine(profile), 2900) };
  const placed = assign(sized, plannerRoutine(profile), [], 2900);
  assert.deepEqual(
    mains(plan).map((c) => c.date),
    ["2026-11-22", "2026-11-23", "2026-11-25", "2026-11-27"],
  );
  for (const c of mains(plan)) assert.ok(recipe(c.recipe)!.totalMin <= 45, c.recipe);
  assert.equal(new Set(mains(plan).map((c) => c.recipe)).size, 4);
  assert.deepEqual(
    reminders(sized, placed).filter((r) => r.kind === "freeze" || r.kind === "defrost"),
    [],
  );
});

test("the same kitchen gives the same week, and each pick says why", () => {
  for (const mode of ["batch", "fresh"] as const) {
    const plan = week(mode);
    assert.deepEqual(week(mode), plan);
    const names = mains(plan).map((c) => recipe(c.recipe)!.name);
    const shares = mains(plan).filter((c) => c.why?.some((w) => w.startsWith("Shares the")));
    assert.ok(shares.length > 0, `${mode}: something is shared`);
    for (const c of shares) {
      const w = c.why!.find((x) => x.startsWith("Shares the"))!;
      assert.ok(
        names.some((n) => n !== recipe(c.recipe)!.name && w.endsWith(`with ${n}`)),
        w,
      );
    }
  }
});

test("a dish grows by up to 15% to finish a pack, within the calorie target, when nothing else needs buying", () => {
  const routine = plannerRoutine(profile);
  const plan: WeekPlan = {
    start: START,
    cooks: [{ id: "a", recipe: "bolognese", date: START, start: 1080, portions: 0, scale: 1 }],
    breakfast: "",
    shake: "",
    fresh: [],
    out: [],
  };
  const sized = sizeCooks(plan, routine, 2900)[0];
  const r = recipe("bolognese")!;
  // Made-up products: the mince comes in a pack 8% bigger than the week needs, and
  // everything else in packs with half as much again to spare.
  const products: Product[] = r.lines.map((l) => {
    const ing = INGREDIENTS.get(l.item)!;
    const need = r.lines
      .filter((x) => x.item === l.item)
      .reduce((t, x) => t + (x.qty * sized.portions * sized.scale) / r.portions, 0);
    const meat = ing.aisle === "Meat & fish";
    return {
      item: l.item,
      url: "https://example.test/p",
      name: "Example",
      packQty: Math.round(need * (meat ? 1.08 : 1.5)),
      packUnit: ing.unit,
      pence: 300,
      checked: [],
    };
  });
  const k = kitchenOf(profile, { products });
  const { cooks, cost } = roundToPacks(plan, k);
  const round = cooks[0].round ?? 1;
  assert.ok(round > 1 && round <= ROUND_MAX, `grew by ${round}`);
  const before = weekCost(plan, k);
  assert.ok(cost.pence <= before.pence, "nothing more to buy");
  assert.ok(cost.waste < before.waste, "less to go off");
  const after = sizeCooks({ ...plan, cooks }, routine, 2900)[0];
  const target = cookScale(r, 2900);
  assert.ok(after.scale >= target && after.scale <= target * ROUND_MAX + 1e-9, "portions stay within 15% of target");
});

test("a portion costs its share of each pack, at your prices once you set them", () => {
  const r = recipe("bolognese")!;
  const typical = portionCost(r, []);
  assert.ok(typical > 0);
  const dearer: Product[] = r.lines.map((l) => {
    const ing = INGREDIENTS.get(l.item)!;
    return {
      item: l.item,
      url: "https://example.test/p",
      name: "Example",
      packQty: ing.pack.qty,
      packUnit: ing.pack.unit,
      pence: ing.pack.pence * 2,
      checked: [],
    };
  });
  assert.ok(Math.abs(portionCost(r, dearer) - 2 * typical) <= 1, "twice the prices, twice the cost");
  assert.ok(Math.abs(portionCost(r, [], 1.5) - 1.5 * typical) <= 1, "a bigger portion costs more");
});
