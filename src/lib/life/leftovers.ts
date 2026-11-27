// Cooked food in the kitchen that a meal can be eaten from in place of the plan:
// the leftovers of another dish. It is safe while it is in date, by the Food
// Standards Agency: its days in the fridge (two, rice one), and any day from the
// freezer. Pure, so it is tested; the Meals page and Claude's tools both use it.
// The owner can judge one fridge batch still fine for up to two days more
// ("Still fine until"); that day then stands in for the rule's.

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
  /** The last day it is eaten by from the fridge; null in the freezer. */
  eatBy: string | null;
  /** The owner said it is still fine until eatBy, past the rule's day. */
  ownCall: boolean;
};

/** The Food Standards Agency's advice, shown before the owner keeps food past its eat-by. */
export const FSA_ADVICE =
  "The Food Standards Agency advises eating leftovers within two days (rice within one), or freezing them.";

/** How many days past the rule's eat-by the owner can say a batch is still fine. */
export const MAX_EXTRA_DAYS = 2;

/** The last day a fridge batch is safe by the rule: its days in the fridge from cooking. */
export function ruleEatBy(cookedOn: string, keeps: Pick<Recipe["keeps"], "fridgeDays">): string {
  return addDays(cookedOn, keeps.fridgeDays);
}

/** The last day a fridge batch is eaten by: the owner's day when set, else the rule's. */
export function fridgeEatBy(
  cookedOn: string,
  keeps: Pick<Recipe["keeps"], "fridgeDays">,
  fineUntil: string | null | undefined,
): string {
  return fineUntil ?? ruleEatBy(cookedOn, keeps);
}

/**
 * Why a day can't be the one a fridge batch is still fine until, or null when it
 * can: later than the rule's eat-by and at most two days past it.
 */
export function fineUntilProblem(
  cookedOn: string,
  keeps: Pick<Recipe["keeps"], "fridgeDays">,
  until: string,
): string | null {
  const rule = ruleEatBy(cookedOn, keeps);
  if (until <= rule) return `It is fine until '${rule}' anyway, by the rule.`;
  const last = addDays(rule, MAX_EXTRA_DAYS);
  if (until > last) return `At most two days past its eat-by: '${last}' at the latest.`;
  return null;
}

/**
 * The next day "Still fine until" offers for a fridge batch on `today`: a day past
 * its current eat-by and not before today, or null once it is two days past the rule.
 */
export function nextFineUntil(
  cookedOn: string,
  keeps: Pick<Recipe["keeps"], "fridgeDays">,
  fineUntil: string | null | undefined,
  today: string,
): string | null {
  const after = addDays(fridgeEatBy(cookedOn, keeps, fineUntil), 1);
  const next = after < today ? today : after;
  return fineUntilProblem(cookedOn, keeps, next) === null ? next : null;
}

/** A cooked batch as leftovers, with the last day it is safe. */
export function asLeftover(
  b: {
    gid: string;
    remaining: number;
    location: "fridge" | "freezer";
    cookedOn: string;
    fineUntil?: string | null;
  },
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
    eatBy: b.location === "fridge" ? fridgeEatBy(b.cookedOn, r.keeps, b.fineUntil) : null,
    ownCall: b.location === "fridge" && Boolean(b.fineUntil),
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
