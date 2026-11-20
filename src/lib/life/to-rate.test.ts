import { test } from "node:test";
import assert from "node:assert/strict";
import type { MealLog } from "./state.ts";
import { toRate } from "./to-rate.ts";

const ate = (day: string, recipe: string | null, status: MealLog["status"] = "eaten"): MealLog => ({
  day,
  slot: "dinner",
  status,
  recipe,
  batchGid: null,
  kcal: 700,
  protein: 40,
  note: null,
});

test("dishes eaten this week and not rated come up for a star, newest first, each once", () => {
  const meals = [
    ate("2026-11-14", "chicken-parm"),
    ate("2026-11-18", "bolognese"),
    ate("2026-11-19", "chicken-parm"),
    ate("2026-11-19", "bolognese"),
  ];
  assert.deepEqual(toRate(meals, [], "2026-11-20"), ["chicken-parm", "bolognese"]);
});

test("rated dishes, swapped or skipped meals, daily breakfasts, shakes and older meals don't", () => {
  const meals = [
    ate("2026-11-19", "chicken-parm"),
    ate("2026-11-19", "bolognese", "swapped"),
    ate("2026-11-19", "porridge"),
    ate("2026-11-19", "raspberry-shake"),
    ate("2026-11-10", "cottage-pie"),
    ate("2026-11-19", null),
  ];
  assert.deepEqual(toRate(meals, [{ recipe: "chicken-parm" }], "2026-11-20"), []);
});

test("at most three at a time", () => {
  const meals = ["chicken-parm", "bolognese", "cottage-pie", "sausage-ragu"].map((r) => ate("2026-11-19", r));
  assert.equal(toRate(meals, [], "2026-11-20").length, 3);
});
