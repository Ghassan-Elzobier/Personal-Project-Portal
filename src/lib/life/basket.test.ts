import { test } from "node:test";
import assert from "node:assert/strict";
import { aislesToVisit, basketProgress, toggle, type BasketLine } from "./basket.ts";

const lines: BasketLine[] = [
  { item: "chicken-thigh", packs: 1, pence: 695 },
  { item: "onion", packs: 1, pence: 90 },
  { item: "pasta", packs: 2, pence: 260 },
  // Already in the kitchen: not on the list.
  { item: "garlic", packs: 0, pence: 0 },
];

test("the running total counts what is ticked, and what the shop didn't have is off the list", () => {
  assert.deepEqual(basketProgress(lines, [], [], null), { got: 0, of: 3, pence: 0, left: 1045, spare: null });
  assert.deepEqual(basketProgress(lines, ["chicken-thigh"], ["pasta"], 1000), {
    got: 1,
    of: 2,
    pence: 695,
    left: 90,
    spare: 305,
  });
  // Over this shop's budget: spare goes negative.
  assert.equal(basketProgress(lines, ["chicken-thigh", "onion", "pasta"], [], 900).spare, -145);
});

test("only the aisles the list needs, in store order", () => {
  const order = ["Fruit & veg", "Meat & fish", "Dairy", "Pasta, rice & grains"];
  const shop = [
    { item: "chicken-thigh", aisle: "Meat & fish", packs: 1 },
    { item: "pasta", aisle: "Pasta, rice & grains", packs: 1 },
    { item: "milk", aisle: "Dairy", packs: 0 },
    { item: "onion", aisle: "Fruit & veg", packs: 1 },
  ];
  assert.deepEqual(aislesToVisit(shop, order, []), ["Fruit & veg", "Meat & fish", "Pasta, rice & grains"]);
  assert.deepEqual(aislesToVisit(shop, order, ["onion"]), ["Meat & fish", "Pasta, rice & grains"]);
});

test("an item is ticked, not found or open, never two at once", () => {
  let s = { ticked: [] as string[], missing: [] as string[] };
  s = toggle(s, "onion", "got");
  assert.deepEqual(s, { ticked: ["onion"], missing: [] });
  s = toggle(s, "onion", "missing");
  assert.deepEqual(s, { ticked: [], missing: ["onion"] });
  s = toggle(s, "onion", "open");
  assert.deepEqual(s, { ticked: [], missing: [] });
});
