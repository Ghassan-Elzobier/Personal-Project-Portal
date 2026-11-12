import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES } from "./recipes.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { portionMacros, verdict } from "./nutrition.ts";
import { GROUPS, type FoodRules } from "./allergens.ts";

// The hardest common restrictions to cook around, which the library is written to
// avoid: nuts, all legumes, egg except baked, in batter, coatings or pasta, and the
// fruits most often behind oral allergy syndrome.
const strict: FoodRules = {
  rules: [
    { tag: "egg", level: "avoid", allowForms: ["baked", "batter", "coating", "pasta"] },
    ...[...GROUPS.nuts.tags, ...GROUPS.legumes.tags].map((tag) => ({ tag, level: "avoid" as const })),
    { tag: "apple", level: "avoid" },
    { tag: "banana", level: "avoid" },
  ],
  mayContainOk: [],
  // Not allergies: tangy soft dairy is written out of the library too.
  dislikes: ["greek-yoghurt", "cream-cheese"],
  avoidTraits: ["strong"],
};

test("every recipe line names a known ingredient", () => {
  for (const r of RECIPES) for (const l of r.lines) assert.ok(INGREDIENTS.has(l.item), `${r.key}: ${l.item}`);
});

test("recipe keys are unique", () => {
  assert.equal(new Set(RECIPES.map((r) => r.key)).size, RECIPES.length);
});

test("every recipe passes the strict rules the library is written for", () => {
  for (const r of RECIPES) {
    const v = verdict(r, strict);
    assert.ok(v.ok, `${r.key}: ${v.blocked.map((b) => b.why).join("; ")}`);
    assert.deepEqual(v.disliked, [], r.key);
  }
});

test("no five-spice, sweet chilli or BBQ sauce: the library keeps sweet out of savoury", () => {
  for (const r of RECIPES) for (const l of r.lines) assert.ok(!["five-spice", "sweet-chilli", "bbq-sauce", "pineapple"].includes(l.item), `${r.key}: ${l.item}`);
});

test("egg always says how it is used", () => {
  for (const r of RECIPES) for (const l of r.lines) if (l.item === "egg") assert.ok(l.form, `${r.key} uses egg without a form`);
});

test("portions are bulking-sized and high in protein", () => {
  for (const r of RECIPES) {
    const m = portionMacros(r);
    if (r.meal === "main") {
      assert.ok(m.kcal >= 550 && m.kcal <= 1150, `${r.key}: ${Math.round(m.kcal)} kcal`);
      assert.ok(m.protein >= 30, `${r.key}: ${Math.round(m.protein)} g protein`);
    } else {
      assert.ok(m.kcal >= 450 && m.kcal <= 900, `${r.key}: ${Math.round(m.kcal)} kcal`);
      assert.ok(m.protein >= 18, `${r.key}: ${Math.round(m.protein)} g protein`);
    }
  }
});

test("rice dishes keep one day in the fridge, other cooked mains at most two", () => {
  for (const r of RECIPES) {
    const rice = r.lines.some((l) => ["basmati", "jasmine", "arborio"].includes(l.item));
    if (rice) assert.equal(r.keeps.fridgeDays, 1, r.key);
    if (rice) assert.equal(r.keeps.rice, true, r.key);
    if (r.meal === "main") assert.ok(r.keeps.fridgeDays <= 2, r.key);
  }
});
