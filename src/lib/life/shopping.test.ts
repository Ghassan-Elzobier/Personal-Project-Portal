import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES, type FoodRules } from "./allergens.ts";
import { isSainsburysProduct, packFromSlug } from "./ingredients.ts";
import { buildList, cookUse, delivery, listTotal, soonToUse, type Need } from "./shopping.ts";

const rules: FoodRules = {
  ...NO_RULES,
  rules: [
    { tag: "soy", level: "avoid" },
    { tag: "egg", level: "avoid", allowForms: ["baked"] },
  ],
};

test("stock comes off and the rest rounds up to packs", () => {
  const needs: Need[] = [
    { item: "chicken-thigh", qty: 1500, firstUse: "2026-11-15", uses: ["x"] },
    { item: "onion", qty: 4, firstUse: "2026-11-15", uses: ["x"] },
  ];
  const lines = buildList(
    needs,
    [{ item: "chicken-thigh", qty: 600, status: null, goodUntil: null }],
    [],
    NO_RULES,
    "2026-11-14",
  );
  const chicken = lines.find((l) => l.item.key === "chicken-thigh")!;
  assert.equal(chicken.packs, 1);
  assert.equal(chicken.spare, 100);
  assert.equal(lines.find((l) => l.item.key === "onion")!.packs, 1);
});

test("staples are bought only when low or out", () => {
  const needs: Need[] = [{ item: "olive-oil", qty: 30, firstUse: "2026-11-15", uses: ["x"] }];
  assert.equal(
    buildList(needs, [{ item: "olive-oil", qty: 0, status: "have", goodUntil: null }], [], NO_RULES, null)[0].packs,
    0,
  );
  assert.equal(
    buildList(needs, [{ item: "olive-oil", qty: 0, status: "low", goodUntil: null }], [], NO_RULES, null)[0].packs,
    1,
  );
});

test("your product's pack and price replace the typical ones", () => {
  const needs: Need[] = [{ item: "chicken-thigh", qty: 900, firstUse: "2026-11-15", uses: ["x"] }];
  const [line] = buildList(
    needs,
    [],
    [
      {
        item: "chicken-thigh",
        url: "https://www.sainsburys.co.uk/gol-ui/product/x-500g",
        name: "X",
        packQty: 500,
        packUnit: "g",
        pence: 400,
        checked: [],
      },
    ],
    NO_RULES,
    null,
  );
  assert.equal(line.packs, 2);
  assert.equal(line.pence, 800);
  assert.equal(line.priced, "yours");
  assert.equal(listTotal([line]).pence, 800);
});

test("label checks follow the rules and drop once confirmed", () => {
  const needs: Need[] = [{ item: "bagel", qty: 5, firstUse: "2026-11-15", uses: ["x"] }];
  assert.deepEqual(buildList(needs, [], [], rules, null)[0].checks, ["soy"]);
  const confirmed = buildList(
    needs,
    [],
    [
      {
        item: "bagel",
        url: "https://www.sainsburys.co.uk/gol-ui/product/bagels",
        name: "B",
        packQty: 5,
        packUnit: "each",
        pence: 125,
        checked: ["soy"],
      },
    ],
    rules,
    null,
  );
  assert.deepEqual(confirmed[0].checks, []);
});

test("fresh meat for a later cook is frozen on arrival", () => {
  const needs: Need[] = [{ item: "beef-mince", qty: 500, firstUse: "2026-11-18", uses: ["x"] }];
  assert.equal(buildList(needs, [], [], NO_RULES, "2026-11-14")[0].freezeOnArrival, true);
  assert.equal(buildList(needs, [], [], NO_RULES, "2026-11-17")[0].freezeOnArrival, false);
});

test("a delivery adds what arrived, a cook takes it away", () => {
  const needs: Need[] = [{ item: "chicken-thigh", qty: 800, firstUse: "2026-11-15", uses: ["x"] }];
  const lines = buildList(needs, [], [], NO_RULES, "2026-11-14");
  assert.deepEqual(delivery(lines, ["chicken-thigh"], "2026-11-14"), [
    { item: "chicken-thigh", add: 1000, status: null, goodUntil: "2026-11-17" },
  ]);
  assert.deepEqual(delivery(lines, [], "2026-11-14"), []);
});

test("cooking uses the recipe at its size, skipping staples", () => {
  // Recipe import is lazy, so read one through the module.
  return import("./recipes.ts").then(({ recipe }) => {
    const use = cookUse(recipe("bolognese")!, 6, 1);
    assert.ok(use.some((u) => u.item === "beef-mince" && u.qty === 1000));
    assert.ok(!use.some((u) => u.item === "oregano"));
  });
});

test("use-soon lists fresh food within two days", () => {
  const rows = soonToUse(
    [
      { item: "spinach", qty: 100, status: null, goodUntil: "2026-11-16" },
      { item: "milk", qty: 500, status: null, goodUntil: "2026-11-25" },
    ],
    "2026-11-15",
  );
  assert.deepEqual(
    rows.map((r) => r.item),
    ["spinach"],
  );
});

test("Sainsbury's product links only, and pack sizes from their slugs", () => {
  assert.ok(
    isSainsburysProduct("https://www.sainsburys.co.uk/gol-ui/product/sainsburys-1kg-british-chicken-thigh-fillets"),
  );
  assert.ok(!isSainsburysProduct("https://evil.example/gol-ui/product/x"));
  assert.ok(!isSainsburysProduct("http://www.sainsburys.co.uk/gol-ui/product/x"));
  assert.deepEqual(
    packFromSlug("https://www.sainsburys.co.uk/gol-ui/product/sainsburys-1kg-british-chicken-thigh-fillets"),
    { qty: 1000, unit: "g" },
  );
  assert.deepEqual(packFromSlug("https://www.sainsburys.co.uk/gol-ui/product/sainsburys-whole-milk-2-27l"), {
    qty: 27000,
    unit: "ml",
  });
});
