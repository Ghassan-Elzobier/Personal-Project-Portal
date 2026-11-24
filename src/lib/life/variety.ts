// Variety across weeks: a week's mains are chosen knowing what the weeks before had
// you eat, so a dish you have had a lot of lately waits its turn, while what's in the
// kitchen, the cost and the shopping are weighed as before.
//
// Each lunch and dinner adds a portion's worth of satiation to its dish, and
// satiation halves every week: an inventory that builds with each meal and fades
// between them (McAlister's dynamic attribute satiation model, 1982). Boredom grows
// even with a dish eaten once a week (Zandstra, de Graaf and van Trijp, 2000), so the
// memory spans weeks, not the fortnight a "last had" date gave. The history is the
// weeks as planned, corrected by the meals logged, so it holds whether or not meals
// get logged. The menu takes points off a main for what is left of its satiation
// (`tiredOf`), in the points the week's set already trades against pounds, waste and
// the list (combo.ts), so a varied week wins only when the variety is worth what it
// costs. Pure, so it is tested.

import { assign, type Placement } from "./planner.ts";
import { plannerRoutine } from "./profile.ts";
import { recipe, type Recipe } from "./recipes.ts";
import type { LifeState, MealLog } from "./state.ts";

/** Satiation halves in this many days. */
export const HALF_LIFE_DAYS = 7;

/** A lunch or dinner had on a date. */
export type Had = { date: string; recipe: string };

/** How tired of each main you are on a day: the portions' worth of it still felt, and the last day you had it. */
export type Variety = { dish: Record<string, number>; last: Record<string, string> };

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * The lunches and dinners had before `before`: each meal week's as placed, unless the
 * meal was logged, when the log says what was had (nothing, for one skipped or
 * swapped for something else). A meal logged that no week placed counts too.
 */
export function hadBefore(weeks: Placement[][], meals: MealLog[], before: string): Had[] {
  const had = new Map<string, string>();
  for (const p of weeks.flat())
    if ((p.slot === "lunch" || p.slot === "dinner") && p.recipe && p.date < before) had.set(p.id, p.recipe);
  for (const m of meals) {
    if ((m.slot !== "lunch" && m.slot !== "dinner") || m.day >= before) continue;
    const id = `${m.day}:${m.slot}`;
    const eaten = m.status === "eaten" ? (m.recipe ?? had.get(id)) : null;
    if (eaten) had.set(id, eaten);
    else had.delete(id);
  }
  return [...had].map(([id, key]) => ({ date: id.slice(0, 10), recipe: key }));
}

/** How tired of each main you are on `on`, from the mains had before it. */
export function varietyOn(had: Had[], on: string): Variety {
  const v: Variety = { dish: {}, last: {} };
  for (const h of had) {
    const r = recipe(h.recipe);
    const age = daysBetween(h.date, on);
    if (!r || r.meal !== "main" || age < 1) continue;
    v.dish[r.key] = (v.dish[r.key] ?? 0) + 0.5 ** (age / HALF_LIFE_DAYS);
    const was = v.last[r.key];
    if (!was || was < h.date) v.last[r.key] = h.date;
  }
  return v;
}

/**
 * Points off a main for the portions' worth of it still felt. Satiation weighs more
 * the more of it there is (in McAlister's model, liking falls with the square of the
 * inventory past its ideal): three portions in the three days before cost about 4
 * points, as a "last had" date did before; three a week earlier, about 1.3; and three
 * every week for six weeks, over 12. A point is worth about a pound to the week's set
 * (combo.ts).
 */
export function tiredOf(v: Variety, r: Recipe): number {
  const felt = v.dish[r.key] ?? 0;
  return felt * (0.6 + 0.4 * felt);
}

/**
 * The variety a new plan for the meal week starting `start` begins from, on the day it
 * plans from (`start`, or today for a week already running): every earlier meal week
 * as placed, this one as it stands with its meals still to come, corrected by the
 * meals logged. So next week, planned the moment this week's last cook is logged,
 * knows the dishes this week is still eating, whether or not meals get logged.
 */
export function varietyFor(
  s: Pick<LifeState, "plans" | "meals" | "profile" | "kcal" | "today" | "weekStart" | "placements">,
  start: string,
): Variety {
  const routine = plannerRoutine(s.profile);
  const weeks = s.plans
    .filter((p) => p.start < start)
    .map((p) => (p.start === s.weekStart ? s.placements : assign(p.data, routine, [], s.kcal)));
  const on = start > s.today ? start : s.today;
  return varietyOn(hadBefore(weeks, s.meals, on), on);
}
