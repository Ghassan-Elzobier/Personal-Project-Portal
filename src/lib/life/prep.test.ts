import { test } from "node:test";
import assert from "node:assert/strict";
import { INGREDIENTS } from "./ingredients.ts";
import { cookPlan, preheats, type PrepCook } from "./prep.ts";
import { RECIPES, recipe, type Recipe } from "./recipes.ts";

const cook = (key: string, o: Partial<PrepCook> = {}): PrepCook => ({
  id: `2026-11-18-${key}`,
  recipe: recipe(key) as Recipe,
  portions: 4,
  scale: 1,
  freeze: 0,
  date: "2026-11-18",
  cooked: false,
  ...o,
});

test("get ready runs marinades and heat first, then weighing, veg, and raw meat last with a wash after", () => {
  const { ready } = cookPlan([cook("bolognese"), cook("chicken-parm")]);
  const at = (re: RegExp) => ready.findIndex((s) => re.test(s));
  const weigh = at(/^Weigh out /);
  const veg = at(/^Prep /);
  const meat = at(/^Raw meat and fish last/);
  const wash = at(/^Then wash your hands/);
  assert.ok(weigh >= 0 && veg > weigh && meat > veg && wash === meat + 1, ready.join("\n"));
  assert.equal(wash, ready.length - 1);
});

test("an ingredient two dishes share is listed once, with its total and what each dish takes", () => {
  const a = cook("bolognese");
  const b = cook("chicken-parm");
  const shared = a.recipe.lines.map((l) => l.item).find((i) => b.recipe.lines.some((l) => l.item === i))!;
  const name = INGREDIENTS.get(shared)!.name;
  const mentions = cookPlan([a, b]).ready.filter((s) => s.includes(name));
  assert.equal(mentions.length, 1, `'${name}'`);
  assert.match(
    mentions[0],
    new RegExp(`for ${a.recipe.name}.*for ${b.recipe.name}|for ${b.recipe.name}.*for ${a.recipe.name}`),
  );
});

test("every recipe that states an oven or air fryer heat has it in get ready", () => {
  for (const r of RECIPES) {
    const heat = preheats(r);
    if (!heat.length) continue;
    const { ready } = cookPlan([cook(r.key)]);
    for (const h of heat) assert.ok(ready.includes(`Heat the ${h.kit} to ${h.c}°C.`), `'${r.key}' ${h.kit}`);
  }
});

test("every recipe with raw meat or fish says how to tell it is done", () => {
  for (const r of RECIPES) {
    const raw = r.lines.some((l) => INGREDIENTS.get(l.item)?.raw);
    const { dishes } = cookPlan([cook(r.key)]);
    if (raw) assert.match(dishes[0].done ?? "", /^Done when (the|there)/, `'${r.key}'`);
    else assert.equal(dishes[0].done, null, `'${r.key}'`);
  }
});

test("box up puts every portion somewhere, with the fridge's eat-by day, and says to chill within 2 hours", () => {
  const { boxUp } = cookPlan([cook("bolognese", { portions: 5, freeze: 2 })]);
  const fridgeDays = recipe("bolognese")!.keeps.fridgeDays;
  const eatBy = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.parse("2026-11-18T12:00:00Z") + fridgeDays * 86_400_000),
  );
  assert.equal(
    boxUp[0],
    `${recipe("bolognese")!.name}: 5 boxes, 3 in the fridge (eat by ${eatBy}) and 2 in the freezer.`,
  );
  assert.ok(boxUp.some((s) => /within 2 hours/.test(s)));
});

test("the dish with the longest wait starts first", () => {
  const keys = ["bolognese", "chicken-parm"];
  const { dishes } = cookPlan(keys.map((k) => cook(k)));
  const wait = (k: string) => recipe(k)!.totalMin - recipe(k)!.activeMin;
  assert.deepEqual(
    dishes.map((d) => d.key),
    [...keys].sort((a, b) => wait(b) - wait(a)),
  );
});

test("two dishes that both need the air fryer are flagged", () => {
  const air = RECIPES.filter((r) => r.kit.includes("air fryer") && r.meal === "main").slice(0, 2);
  assert.equal(air.length, 2);
  const { warnings } = cookPlan(air.map((r) => cook(r.key)));
  assert.ok(
    warnings.some((w) => /both use the air fryer/.test(w)),
    warnings.join("\n"),
  );
});
