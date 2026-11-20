// Eating a meal from a planned cook means the cook happened. These say which
// cooks a meal or a run of meals comes from that aren't logged yet, which meals
// were eaten before their cook was logged (so nothing came out of the fridge),
// and how to tell the owner. Pure, so it is tested.

import type { Placement } from "./planner.ts";
import type { MealLog } from "./state.ts";

/** A cook logged because a meal from it was eaten. */
export type CookedNote = { cookId: string; name: string; batch: string; fridge: number; freezer: number };

/** Planned cooks these meals come from that aren't logged yet, each once. */
export function cooksToLog(placements: Placement[]): string[] {
  return [...new Set(placements.filter((p) => p.source === "cook" && p.cookId && !p.batchGid).map((p) => p.cookId!))];
}

/**
 * Meals from this cook logged as eaten while it wasn't logged, so no portion came
 * out of a batch. Read after the cook is logged, each now has the batch it ate from.
 */
export function eatenBeforeCooked(
  placements: Placement[],
  meals: MealLog[],
  cookId: string,
): { placement: Placement; meal: MealLog }[] {
  return placements.flatMap((placement) => {
    if (placement.cookId !== cookId || !placement.batchGid) return [];
    const meal = meals.find((m) => m.day === placement.date && m.slot === placement.slot);
    return meal && meal.status === "eaten" && !meal.batchGid ? [{ placement, meal }] : [];
  });
}

/** "Logged the cook too: Bolognese, 3 in the fridge and 2 in the freezer." */
export function cookedNote(cooked: CookedNote[]): string | null {
  if (!cooked.length) return null;
  const where = (c: CookedNote) =>
    [c.fridge && `${c.fridge} in the fridge`, c.freezer && `${c.freezer} in the freezer`].filter(Boolean).join(" and ");
  if (cooked.length === 1) return `Logged the cook too: ${cooked[0].name}, ${where(cooked[0])}.`;
  return `Logged ${cooked.length} cooks too: ${cooked.map((c) => `${c.name} (${where(c)})`).join("; ")}.`;
}
