// Stars are what the planner learns from (suggest.ts `rank`), but they were only
// asked for at the foot of a recipe page. These are the dishes worth a quick star:
// eaten in the last week, not rated yet. Pure, so it is tested.

import { addDays } from "../dates/week.ts";
import { recipe } from "./recipes.ts";
import type { MealLog } from "./state.ts";

/** Dishes eaten in the last 7 days and not rated, newest first: mains and batch breakfasts, not daily ones. */
export function toRate(meals: MealLog[], ratings: { recipe: string }[], today: string, limit = 3): string[] {
  const rated = new Set(ratings.map((r) => r.recipe));
  const since = addDays(today, -7);
  const out: string[] = [];
  for (const m of [...meals].sort((a, b) => b.day.localeCompare(a.day))) {
    if (m.status !== "eaten" || !m.recipe || m.day > today || m.day < since) continue;
    const r = recipe(m.recipe);
    if (!r || r.meal === "shake" || r.daily || rated.has(r.key) || out.includes(r.key)) continue;
    out.push(r.key);
    if (out.length >= limit) break;
  }
  return out;
}
