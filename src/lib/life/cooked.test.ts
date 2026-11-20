import { test } from "node:test";
import assert from "node:assert/strict";
import { cookedNote, cooksToLog, eatenBeforeCooked } from "./cooked.ts";
import type { Placement } from "./planner.ts";
import type { MealLog } from "./state.ts";

const at = (over: Partial<Placement>): Placement => ({
  id: `${over.date ?? "2026-11-16"}:${over.slot ?? "lunch"}`,
  date: "2026-11-16",
  slot: "lunch",
  time: 750,
  recipe: "bolognese",
  source: "cook",
  scale: 1,
  ...over,
});
const ate = (over: Partial<MealLog>): MealLog => ({
  day: "2026-11-16",
  slot: "lunch",
  status: "eaten",
  recipe: "bolognese",
  batchGid: null,
  kcal: 800,
  protein: 50,
  note: null,
  ...over,
});

test("a meal from a planned cook that isn't logged asks for that cook, once", () => {
  const meals = [
    at({ cookId: "c1" }),
    at({ cookId: "c1", slot: "dinner" }),
    at({ cookId: "c2", slot: "dinner", date: "2026-11-17" }),
  ];
  assert.deepEqual(cooksToLog(meals), ["c1", "c2"]);
});

test("nothing is asked for once the cook is logged, nor for daily, fresh, stock or eating-out meals", () => {
  assert.deepEqual(
    cooksToLog([
      at({ cookId: "c1", batchGid: "7" }),
      at({ source: "daily", recipe: "porridge" }),
      at({ source: "fresh", cookId: undefined }),
      at({ source: "stock", batchGid: "3" }),
      at({ source: "out", recipe: null }),
    ]),
    [],
  );
});

test("meals eaten before their cook was logged are found, with the batch they ate from", () => {
  const placements = [
    at({ cookId: "c1", batchGid: "7" }),
    at({ cookId: "c1", batchGid: "7", slot: "dinner" }),
    at({ cookId: "c1", batchGid: "8", date: "2026-11-17", slot: "lunch" }),
    at({ cookId: "c2", batchGid: "9", date: "2026-11-17", slot: "dinner" }),
  ];
  const meals = [
    ate({}),
    // Already took its portion: left alone.
    ate({ slot: "dinner", batchGid: "7" }),
    // Skipped, not eaten.
    ate({ day: "2026-11-17", slot: "lunch", status: "skipped" }),
    // Another cook's.
    ate({ day: "2026-11-17", slot: "dinner" }),
  ];
  const found = eatenBeforeCooked(placements, meals, "c1");
  assert.deepEqual(
    found.map((f) => [f.meal.day, f.meal.slot, f.placement.batchGid]),
    [["2026-11-16", "lunch", "7"]],
  );
});

test("the note says which cook was logged and where its portions went", () => {
  assert.equal(cookedNote([]), null);
  assert.equal(
    cookedNote([{ cookId: "c1", name: "Bolognese", batch: "7", fridge: 3, freezer: 2 }]),
    "Logged the cook too: Bolognese, 3 in the fridge and 2 in the freezer.",
  );
  assert.equal(
    cookedNote([
      { cookId: "c1", name: "Bolognese", batch: "7", fridge: 3, freezer: 0 },
      { cookId: "c2", name: "Cottage pie", batch: "9", fridge: 0, freezer: 4 },
    ]),
    "Logged 2 cooks too: Bolognese (3 in the fridge); Cottage pie (4 in the freezer).",
  );
});
