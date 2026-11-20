import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES } from "./allergens.ts";
import { INGREDIENTS, type Ingredient } from "./ingredients.ts";
import { linkDisagrees, packFromSlug, packProblem, packUnits } from "./pack.ts";
import { buildList, delivery, packInItemUnit, type Product } from "./shopping.ts";

const product = (slug: string) => `https://www.sainsburys.co.uk/gol-ui/product/${slug}`;

test("a Sainsbury's slug writes a decimal point as a hyphen: 2-27l is 2.27 litres, not 27", () => {
  assert.deepEqual(packFromSlug(product("sainsburys-british-whole-milk-2-27l-4-pints")), { qty: 2270, unit: "ml" });
  assert.deepEqual(packFromSlug(product("sainsburys-semi-skimmed-milk-1-136l")), { qty: 1136, unit: "ml" });
  assert.deepEqual(packFromSlug(product("sainsburys-white-potatoes-2-5kg")), { qty: 2500, unit: "g" });
  assert.deepEqual(packFromSlug(product("sainsburys-orange-juice-1l?ref=share")), { qty: 1000, unit: "ml" });
});

test("whole sizes and counts read as before", () => {
  assert.deepEqual(packFromSlug(product("sainsburys-1kg-british-chicken-thigh-fillets")), { qty: 1000, unit: "g" });
  assert.deepEqual(packFromSlug(product("sainsburys-chopped-tomatoes-400g")), { qty: 400, unit: "g" });
  assert.deepEqual(packFromSlug(product("sainsburys-passata-500ml")), { qty: 500, unit: "ml" });
  // A multipack's count is not a decimal.
  assert.deepEqual(packFromSlug(product("sainsburys-baking-potatoes-x4")), { qty: 4, unit: "each" });
  assert.equal(packFromSlug(product("sainsburys-fresh-coriander")), null);
});

test("a pack is given in a unit the ingredient's amounts convert to", () => {
  assert.deepEqual(packUnits({ unit: "g" }), ["g", "ml"]);
  assert.deepEqual(packUnits({ unit: "each" }), ["each"]);
  assert.deepEqual(packUnits({ unit: "g", each: 120 }), ["g", "ml", "each"]);
  assert.equal(packProblem({ unit: "g" }, 4, "each"), "This is counted by weight: give the pack in g or ml.");
  assert.equal(packProblem({ unit: "each" }, 500, "g"), "This is counted one by one: give the pack in each.");
  assert.equal(packProblem({ unit: "g" }, 0, "g"), "Give the pack size.");
  assert.equal(packProblem({ unit: "g", each: 120 }, 6, "each"), null);
});

test("a saved pack that disagrees with its own link is caught, and one that agrees is left alone", () => {
  const milk = { unit: "ml" as const };
  const url = product("sainsburys-british-whole-milk-2-27l-4-pints");
  assert.deepEqual(linkDisagrees(milk, { url, packQty: 27000, packUnit: "ml" }), { qty: 2270, unit: "ml" });
  // Four pints typed by hand is close enough to the link's 2.27 l.
  assert.equal(linkDisagrees(milk, { url, packQty: 2272, packUnit: "ml" }), null);
  // A link with no size in it says nothing.
  assert.equal(linkDisagrees(milk, { url: product("sainsburys-fresh-milk"), packQty: 27000, packUnit: "ml" }), null);
});

test("every ingredient's usual pack is one its amounts convert to", () => {
  for (const item of INGREDIENTS.values())
    assert.equal(
      packProblem(item, item.pack.qty, item.pack.unit),
      null,
      `'${item.key}' has a usual pack it can't count`,
    );
});

test("a pack saved in a unit the ingredient can't count in buys the usual pack, never infinitely many", () => {
  const item = [...INGREDIENTS.values()].find((i) => i.unit === "g" && !i.each && !i.staple) as Ingredient;
  const bad: Product = {
    item: item.key,
    url: product("x"),
    name: "x",
    packQty: 4,
    packUnit: "each",
    pence: 300,
    checked: [],
  };
  assert.equal(packInItemUnit(item, 4, "each"), packInItemUnit(item, item.pack.qty, item.pack.unit));
  const [line] = buildList(
    [{ item: item.key, qty: item.pack.qty * 1.5, firstUse: "2026-11-16", uses: ["x"] }],
    [],
    [bad],
    NO_RULES,
    null,
  );
  assert.equal(line.packs, 2);
  assert.equal(line.pence, 600);
  // What goes into the kitchen is what the list bought.
  assert.deepEqual(
    delivery([line], [item.key], "2026-11-16").map((d) => d.add),
    [2 * item.pack.qty],
  );
});
