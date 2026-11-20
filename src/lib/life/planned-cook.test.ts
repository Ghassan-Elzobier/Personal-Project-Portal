import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, recipeAmounts, type LifeRaw } from "./state.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import { cookScale, sizeCooks, type WeekPlan } from "./planner.ts";
import { recipe, type Recipe } from "./recipes.ts";
import { cookUse, weekNeeds } from "./shopping.ts";

// A recipe opened from a planned cook shows that cook's amounts: the ones the
// shopping list bought and "Cooked it" takes out, pack round-up included.

const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  routine: { ...DEFAULT_PROFILE.routine, shake: 510 },
};
const week = (start: string, round?: number): WeekPlan => {
  const plan: WeekPlan = {
    start,
    cooks: [
      { id: `${start}-bolognese`, recipe: "bolognese", date: start, start: 990, portions: 0, scale: 1, round },
      { id: `${start}-cottage-pie`, recipe: "cottage-pie", date: start, start: 990, portions: 0, scale: 1 },
    ],
    breakfast: "bagel-ham",
    shake: "raspberry-shake",
    fresh: [],
    out: [],
    createdOn: "2026-11-14",
  };
  return { ...plan, cooks: sizeCooks(plan, profile.routine as never, 2700) };
};
const raw = (over: Partial<LifeRaw> = {}): LifeRaw => ({
  profile,
  weights: [{ day: "2026-11-16", kg: 65 }],
  plans: [
    { start: "2026-11-15", data: week("2026-11-15", 1.12) },
    { start: "2026-11-22", data: week("2026-11-22") },
  ],
  meals: [],
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
  ...over,
});
const s = buildState(raw(), "2026-11-16");
const bolognese = recipe("bolognese") as Recipe;
const cook = s.plan!.cooks.find((c) => c.recipe === "bolognese")!;
const byItem = (xs: { item: string; qty: number }[]) =>
  Object.fromEntries(xs.map((x) => [x.item, Math.round(x.qty * 10) / 10]));

test("opened from a planned cook, the recipe shows its portions at its size, pack round-up included", () => {
  assert.ok((cook.round ?? 1) > 1, "the fixture's cook is a little bigger to finish a pack");
  const shown = recipeAmounts(s, bolognese, { cook: cook.id });
  assert.equal(shown.planned?.cook.id, cook.id);
  assert.equal(shown.portions, cook.portions);
  assert.equal(shown.scale, cook.scale);
  assert.ok(shown.scale > cookScale(bolognese, s.kcal), "bigger than the target alone");
  assert.equal(shown.changed, false);
});

test("the amounts shown are the ones the list bought and Cooked it takes out", () => {
  const shown = recipeAmounts(s, bolognese, { cook: cook.id });
  const bought = weekNeeds({ ...s.plan!, cooks: [cook] }, []);
  assert.deepEqual(byItem(shown.lines), byItem(bought));
  const takenOut = byItem(cookUse(bolognese, cook.portions, cook.scale));
  for (const [item, qty] of Object.entries(takenOut)) assert.equal(byItem(shown.lines)[item], qty, `'${item}'`);
});

test("next week's cook is found too, and a changed portion count says it no longer matches the list", () => {
  const next = s.next.plan!.cooks.find((c) => c.recipe === "bolognese")!;
  assert.equal(recipeAmounts(s, bolognese, { cook: next.id }).planned?.start, "2026-11-22");
  const more = recipeAmounts(s, bolognese, { cook: cook.id, portions: cook.portions + 1 });
  assert.equal(more.portions, cook.portions + 1);
  assert.equal(more.scale, cook.scale);
  assert.equal(more.changed, true);
});

test("without a cook, or with one that isn't this recipe's, it is the recipe as written, sized to the target", () => {
  for (const ask of [{}, { cook: "2026-11-15-cottage-pie" }, { cook: "nope" }]) {
    const shown = recipeAmounts(s, bolognese, ask);
    assert.equal(shown.planned, null);
    assert.equal(shown.portions, bolognese.portions);
    assert.equal(shown.scale, cookScale(bolognese, s.kcal));
    assert.equal(shown.changed, false);
  }
});

test("a cooked cook says so", () => {
  const cooked = buildState(
    raw({
      batches: [
        {
          gid: "b1",
          recipe: "bolognese",
          cookedOn: "2026-11-15",
          portions: cook.portions,
          remaining: cook.portions,
          location: "fridge",
          planStart: "2026-11-15",
          cookId: cook.id,
        } as never,
      ],
    }),
    "2026-11-16",
  );
  assert.equal(recipeAmounts(cooked, bolognese, { cook: cook.id }).planned?.done, true);
  assert.equal(recipeAmounts(s, bolognese, { cook: cook.id }).planned?.done, false);
});
