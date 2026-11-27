// Cooked food in the kitchen that a meal can be eaten from in place of the plan:
// the leftovers of another dish. It is safe while it is in date, by the Food
// Standards Agency: its days in the fridge (two, rice one), and any day from the
// freezer. Pure, so it is tested; the Meals page and Claude's tools both use it.

import { addDays } from "../dates/week.ts";
import type { Slot } from "./nutrition.ts";
import type { Recipe } from "./recipes.ts";

export type Leftover = {
  gid: string;
  recipe: string;
  name: string;
  meal: Recipe["meal"];
  left: number;
  where: "fridge" | "freezer";
  cookedOn: string;
  /** The last day it is safe from the fridge; null in the freezer. */
  eatBy: string | null;
};

/** A cooked batch as leftovers, with the last day it is safe. */
export function asLeftover(
  b: { gid: string; remaining: number; location: "fridge" | "freezer"; cookedOn: string },
  r: Pick<Recipe, "key" | "name" | "meal" | "keeps">,
): Leftover {
  return {
    gid: b.gid,
    recipe: r.key,
    name: r.name,
    meal: r.meal,
    left: b.remaining,
    where: b.location,
    cookedOn: b.cookedOn,
    eatBy: b.location === "fridge" ? addDays(b.cookedOn, r.keeps.fridgeDays) : null,
  };
}

/**
 * The leftovers a meal on `date` can be: a breakfast for breakfast and a main for
 * lunch or dinner, with a portion left, cooked by then and still safe that day, and
 * not the dish the meal is already planned as.
 */
export function leftoversFor(all: Leftover[], date: string, slot: Slot, planned: string | null): Leftover[] {
  if (slot === "shake") return [];
  const kind = slot === "breakfast" ? "breakfast" : "main";
  return all.filter(
    (b) =>
      b.meal === kind &&
      b.left > 0 &&
      b.recipe !== planned &&
      b.cookedOn <= date &&
      (b.eatBy === null || date <= b.eatBy),
  );
}
