import { test } from "node:test";
import assert from "node:assert/strict";
import { asLeftover, leftoversFor } from "./leftovers.ts";
import { recipe } from "./recipes.ts";

// The cooked food a meal can be eaten from in place of the plan. Made-up batches:
// a pasta bake cooked on Monday (two days in the fridge), a rice dish cooked on
// Monday (one day), and a frozen one from last week.

const batch = (gid: string, key: string, cookedOn: string, location: "fridge" | "freezer", remaining = 2) =>
  asLeftover({ gid, remaining, location, cookedOn }, recipe(key)!);
const pasta = batch("1", "tuscan-chicken", "2026-11-16", "fridge");
const rice = batch("2", "garlic-pepper-pork", "2026-11-16", "fridge");
const frozen = batch("3", "sausage-ragu", "2026-11-09", "freezer");
const all = [pasta, rice, frozen];
const keys = (xs: { recipe: string }[]) => xs.map((x) => x.recipe);

test("a batch in the fridge is safe for its fridge days, by the Food Standards Agency, and one in the freezer any day", () => {
  assert.equal(pasta.eatBy, "2026-11-18");
  assert.equal(rice.eatBy, "2026-11-17");
  assert.equal(frozen.eatBy, null);
  assert.equal(pasta.name, recipe("tuscan-chicken")!.name);
});

test("a lunch or dinner is offered the mains still safe that day, cooked by then", () => {
  assert.deepEqual(keys(leftoversFor(all, "2026-11-16", "lunch", null)), [
    "tuscan-chicken",
    "garlic-pepper-pork",
    "sausage-ragu",
  ]);
  // Wednesday: the rice dish has had its day; the pasta's second day is its last.
  assert.deepEqual(keys(leftoversFor(all, "2026-11-18", "dinner", null)), ["tuscan-chicken", "sausage-ragu"]);
  // Thursday: only what is frozen is still safe.
  assert.deepEqual(keys(leftoversFor(all, "2026-11-19", "dinner", null)), ["sausage-ragu"]);
  // Sunday, before Monday's cooks: only last week's frozen batch existed.
  assert.deepEqual(keys(leftoversFor(all, "2026-11-15", "lunch", null)), ["sausage-ragu"]);
});

test("the dish the meal is planned as, an empty batch, a breakfast for lunch and anything for a shake are not offered", () => {
  assert.deepEqual(keys(leftoversFor(all, "2026-11-16", "dinner", "tuscan-chicken")), [
    "garlic-pepper-pork",
    "sausage-ragu",
  ]);
  assert.deepEqual(keys(leftoversFor([{ ...pasta, left: 0 }], "2026-11-16", "lunch", null)), []);
  const muffins = batch("4", "blueberry-muffins", "2026-11-16", "fridge");
  assert.deepEqual(keys(leftoversFor([...all, muffins], "2026-11-16", "breakfast", null)), ["blueberry-muffins"]);
  assert.deepEqual(
    keys(leftoversFor([...all, muffins], "2026-11-16", "lunch", null)).includes("blueberry-muffins"),
    false,
  );
  assert.deepEqual(leftoversFor(all, "2026-11-16", "shake", null), []);
});
