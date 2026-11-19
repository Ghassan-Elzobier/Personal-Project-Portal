import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrice, smartList, toAdd } from "./order.ts";

const lines = [
  { item: "milk", packs: 1, name: "Whole milk", pack: "2.27 l", product: { name: "Example Whole Milk 2.27L" } },
  { item: "rice", packs: 2, name: "Basmati rice", pack: "1 kg", product: null },
  { item: "oats", packs: 0, name: "Porridge oats", pack: "1 kg", product: { name: "Example Oats 1kg" } },
  { item: "thighs", packs: 3, name: "Chicken thighs", pack: "1 kg", product: { name: "Example Chicken Thighs 1kg" } },
];

test("what's left to add skips lines already added, not available, or not needed", () => {
  assert.deepEqual(
    toAdd(lines, ["milk"], ["thighs"]).map((l) => l.item),
    ["rice"],
  );
  assert.deepEqual(
    toAdd(lines, [], []).map((l) => l.item),
    ["milk", "rice", "thighs"],
  );
  assert.deepEqual(toAdd(lines, ["milk", "rice", "thighs"], []), []);
});

test("the SmartLists text puts the packs first, one product per line, and only what's left", () => {
  assert.equal(
    smartList(lines, [], []),
    ["1 x Example Whole Milk 2.27L", "2 x Basmati rice (1 kg)", "3 x Example Chicken Thighs 1kg"].join("\n"),
  );
  assert.equal(smartList(lines, ["milk"], ["rice"]), "3 x Example Chicken Thighs 1kg");
  assert.equal(smartList(lines, ["milk", "rice", "thighs"], []), "");
});

test("a typed price becomes pence, empty is none, and anything else is refused", () => {
  assert.equal(parsePrice("71.40"), 7140);
  assert.equal(parsePrice("£71.4"), 7140);
  assert.equal(parsePrice(" £ 1,071 "), 107100);
  assert.equal(parsePrice("0.99"), 99);
  assert.equal(parsePrice("12"), 1200);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("   "), null);
  assert.equal(parsePrice("abc"), undefined);
  assert.equal(parsePrice("71.405"), undefined);
  assert.equal(parsePrice("-5"), undefined);
  assert.equal(parsePrice("1.2.3"), undefined);
});
