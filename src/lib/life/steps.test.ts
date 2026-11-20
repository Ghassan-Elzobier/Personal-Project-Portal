import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES, type Recipe } from "./recipes.ts";
import { scaledSteps } from "./steps.ts";

const recipe = (r: Partial<Recipe> & { steps: string[] }): Recipe => ({ ...RECIPES[0], portions: 4, ...r });

test("amounts written in the steps scale with the batch, rounded the way a cook measures", () => {
  const r = recipe({
    steps: [
      "Stir in the washed rice, 450 ml water and the chicken. Cover and cook for 25 minutes.",
      "Make 1.2 litres of hot stock, roast at 220°C, and soften in 1 tbsp oil with 20 g flour.",
      "Cube 1 cm pieces and cut into 6.",
    ],
  });
  // Six portions at the written size: one and a half times.
  assert.deepEqual(scaledSteps(r, 6, 1), [
    "Stir in the washed rice, 680 ml water and the chicken. Cover and cook for 25 minutes.",
    "Make 1.8 litres of hot stock, roast at 220°C, and soften in 1.5 tbsp oil with 30 g flour.",
    "Cube 1 cm pieces and cut into 6.",
  ]);
});

test("a large amount reads in litres, a batch the written size is left alone", () => {
  const r = recipe({ steps: ["Pour in 700 ml stock."] });
  assert.deepEqual(scaledSteps(r, 8, 1), ["Pour in 1.4 litres stock."]);
  assert.deepEqual(scaledSteps(r, 4, 1.01), ["Pour in 700 ml stock."]);
});

test("a step about each portion scales with the portion size, not the number of portions", () => {
  const r = recipe({ steps: ["300 ml to drink with each portion"] });
  assert.deepEqual(scaledSteps(r, 8, 1), ["300 ml to drink with each portion"]);
  assert.deepEqual(scaledSteps(r, 8, 1.2), ["360 ml to drink with each portion"]);
});

test("every recipe's steps keep their temperatures and times when scaled", () => {
  for (const r of RECIPES) {
    const scaled = scaledSteps(r, r.portions * 2, 1).join(" ");
    for (const keep of r.steps.join(" ").match(/\d+°C|\d+ minutes?|\d+ hours?/g) ?? [])
      assert.ok(scaled.includes(keep), `'${r.key}' kept '${keep}'`);
  }
});
