import { test } from "node:test";
import assert from "node:assert/strict";
import { labelChecks, labelTags, NO_RULES, type FoodRules } from "./allergens.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { verdict } from "./nutrition.ts";
import { recipe, type Recipe } from "./recipes.ts";

// Labels on mixed products (bread, sauces, stock, sausages, spice blends) are checked
// for every food the rules avoid, in the form the hidden ingredients take, not only
// for what some brands are known to add. Made-up rules: this repository is public.

const rules: FoodRules = {
  ...NO_RULES,
  rules: [
    { tag: "soy", level: "avoid" },
    { tag: "pea", level: "avoid" },
    { tag: "egg", level: "avoid", allowForms: ["baked"] },
    { tag: "sulphite", level: "avoid" },
    { tag: "tree-nut", level: "flag" },
  ],
};
const item = (key: string) => INGREDIENTS.get(key)!;
const checks = (key: string) => labelChecks(rules, item(key).watch, item(key).compound);

test("a mixed product is checked for every food you avoid, in the form its hidden ingredients take", () => {
  // Bread: any egg is baked, which these rules allow.
  assert.deepEqual(checks("bagel").sort(), ["pea", "soy", "sulphite"]);
  // Stock: hidden egg isn't baked, so it is checked.
  assert.ok(checks("stock-chicken").includes("egg"));
  // A food only flagged, not avoided, isn't a label check.
  assert.ok(!checks("stock-chicken").includes("tree-nut"));
});

test("a plain product is checked only for what some brands add", () => {
  assert.deepEqual(checks("veg-oil"), []);
  assert.deepEqual(labelChecks(rules, ["soy"]), ["soy"]);
});

test("sausages are checked for sulphites, and spice blends for pea flour", () => {
  assert.ok(checks("pork-sausages").includes("sulphite"));
  assert.ok(checks("garam-masala").includes("pea"));
});

test("the product form offers every tag worth confirming", () => {
  assert.deepEqual(labelTags(rules, item("veg-oil").watch, item("veg-oil").compound), ["nut-oil"]);
  const bagel = labelTags(rules, item("bagel").watch, item("bagel").compound);
  for (const t of ["soy", "sesame", "egg", "pea", "sulphite"]) assert.ok(bagel.includes(t as never), `'${t}'`);
});

test("a recipe's label checks drop what you already confirmed on the product you buy", () => {
  const parm = recipe("chicken-parm") as Recipe;
  const panko = item("panko").name;
  const before = verdict(parm, rules).checks.find((c) => c.item === panko);
  assert.ok(before && before.tags.includes("soy"));
  const after = verdict(parm, rules, new Map([["panko", ["soy", "pea", "sulphite"] as const]]));
  assert.equal(
    after.checks.find((c) => c.item === panko),
    undefined,
  );
});
