// The menu: recipes ranked for you this week, and a week filled from them in
// one tap, the way a recipe box pre-picks your meals.
//
// Only recipes your rules allow, your kit can cook and your spice limit suits
// are on it. They rank by what you rated, your favourites and cuisines, food in
// the kitchen they would use up, and how long since you last had them. A week
// mixes at most one recipe from outside your usual ("explore") with crowd
// pleasers, and spreads cuisines and meats. Every rank says why. Pure, so it is tested.

import { addDays } from "../dates/week.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { verdict } from "./nutrition.ts";
import type { CookSession, LifeProfile } from "./profile.ts";
import { RECIPES, type Recipe } from "./recipes.ts";
import type { Cook, WeekPlan } from "./planner.ts";

export type Rating = { recipe: string; stars: number };
/** When each recipe was last eaten or cooked. */
export type LastHad = Record<string, string>;

export type Ranked = { recipe: Recipe; score: number; reasons: string[] };

/** The main meat, for spreading the week. */
export function mainProtein(r: Recipe): string {
  let best = "";
  let most = 0;
  for (const l of r.lines) {
    const ing = INGREDIENTS.get(l.item);
    if (!ing || ing.aisle !== "Meat & fish") continue;
    const p = (ing.per100.protein * (ing.unit === "each" ? l.qty * (ing.each ?? 0) : l.qty)) / 100;
    if (p > most) {
      most = p;
      best = ing.key.split("-")[0];
    }
  }
  return best || "other";
}

/** Recipes this profile can cook and eat, for a meal type. */
export function eligible(profile: LifeProfile, meal: Recipe["meal"]): Recipe[] {
  return RECIPES.filter((r) => {
    if (r.meal !== meal) return false;
    if (profile.hidden.includes(r.key)) return false;
    if (r.spice > profile.spiceMax) return false;
    if (r.kit.some((k) => !profile.kit.includes(k))) return false;
    const v = verdict(r, profile.food);
    return v.ok && v.disliked.length === 0;
  });
}

export function rank(
  profile: LifeProfile,
  meal: Recipe["meal"],
  ratings: Rating[],
  lastHad: LastHad,
  spare: Record<string, number>,
  today: string,
): Ranked[] {
  const stars = new Map(ratings.map((r) => [r.recipe, r.stars]));
  return eligible(profile, meal)
    .map((r) => {
      let score = 0;
      const reasons: string[] = [];
      const s = stars.get(r.key);
      if (s !== undefined) {
        score += (s - 3) * 2;
        if (s >= 4) reasons.push(`You rated it ${s} of 5`);
        if (s <= 2) reasons.push(`You rated it ${s} of 5`);
      }
      if (profile.favourites.includes(r.key)) {
        score += 3;
        reasons.push("A favourite");
      }
      if (profile.cuisines.includes(r.cuisine as never)) {
        score += 2;
      }
      if (r.tags.includes("classic")) score += 1;
      if (r.tags.includes("explore") && s === undefined) {
        score += 0.5;
        reasons.push("New: one step further");
      }
      if (profile.routine.lunchAtWork && r.tags.includes("lunchbox")) score += 1;
      const used = r.lines.filter((l) => (spare[l.item] ?? 0) > 0 && INGREDIENTS.get(l.item)?.aisle === "Meat & fish");
      if (used.length) {
        score += 2;
        reasons.push(`Uses the ${INGREDIENTS.get(used[0].item)!.name.toLowerCase()} you have`);
      }
      const last = lastHad[r.key];
      if (last) {
        const ago = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000);
        if (ago < 7) score -= 4;
        else if (ago < 14) score -= 2;
        else if (ago > 28 && (s ?? 3) >= 4) {
          score += 1;
          reasons.push("Not had it in a month");
        }
      }
      return { recipe: r, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name));
}

/** Picks n recipes from a ranking, spreading cuisines and meats, with at most one to explore. */
export function pickSpread(ranked: Ranked[], n: number, avoid: string[] = []): Recipe[] {
  const chosen: Recipe[] = [];
  const pool = ranked.filter((r) => !avoid.includes(r.recipe.key));
  while (chosen.length < n && pool.length) {
    let best = -1;
    let bestScore = -Infinity;
    pool.forEach((c, i) => {
      let s = c.score;
      s -= 2 * chosen.filter((x) => x.cuisine === c.recipe.cuisine).length;
      s -= 1.5 * chosen.filter((x) => mainProtein(x) === mainProtein(c.recipe)).length;
      const exploring = chosen.filter((x) => x.tags.includes("explore")).length;
      if (c.recipe.tags.includes("explore") && exploring >= 1) s -= 10;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    chosen.push(pool[best].recipe);
    pool.splice(best, 1);
  }
  return chosen;
}

/**
 * Weekend dinners cooked fresh, like a Sunday roast or a Saturday steak: Saturday
 * first, then Sunday, skipping days that are cook days or already gone.
 */
export function weekendFresh(
  profile: LifeProfile,
  start: string,
  sessions: { date: string }[],
  ranked: Ranked[],
  today: string,
): WeekPlan["fresh"] {
  const n = profile.routine.weekendFresh;
  if (!n) return [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekend = [...days.filter((d) => weekday(d) === 5), ...days.filter((d) => weekday(d) === 6)].filter(
    (d) => d >= today && !sessions.some((s) => s.date === d),
  );
  const picks = pickSpread(
    ranked.filter((r) => r.recipe.tags.includes("weekend")),
    n,
  );
  return weekend
    .slice(0, n)
    .map((date, i) => ({ date, slot: "dinner" as const, recipe: picks[i % Math.max(1, picks.length)]?.key ?? "" }))
    .filter((f) => f.recipe);
}

/** Cook sessions of a meal week starting on `start`, from the routine. */
const daysUntil = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function sessionDates(start: string, cooks: CookSession[]): { date: string; start: number }[] {
  const startWeekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return cooks
    .map((c) => ({ date: addDays(start, (c.weekday - startWeekday + 7) % 7), start: c.start }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

/**
 * Cook sessions already gone when the week is planned late are replaced by one
 * catch-up session today, so the plan never counts on food nobody cooked.
 */
export function catchUp(sessions: { date: string; start: number }[], today: string): { date: string; start: number }[] {
  const past = sessions.filter((x) => x.date < today);
  if (!past.length) return sessions;
  const future = sessions.filter((x) => x.date >= today);
  if (future.some((x) => x.date === today)) return future;
  return [{ date: today, start: Math.max(...past.map((x) => x.start)) }, ...future];
}

/**
 * A whole week in one go: two mains per cook session, a breakfast batch on the
 * first session, a daily breakfast for the gaps, and the shake. Portions are left
 * at zero for sizeCooks to fill in.
 */
export function suggestWeek(
  profile: LifeProfile,
  start: string,
  ratings: Rating[],
  lastHad: LastHad,
  spare: Record<string, number>,
  today: string,
): WeekPlan {
  const mains = rank(profile, "main", ratings, lastHad, spare, today).filter((r) => !r.recipe.tags.includes("weekend"));
  const sessions = catchUp(sessionDates(start, profile.routine.cooks), today);
  // Each session cooks for the days until the next one. Two mains for that, but
  // one when it only covers a day or two (a week planned late), so a catch-up
  // cook is one pan, not the whole week's cooking on one evening.
  const mainsFor = sessions.map((x, i) => (daysUntil(x.date, sessions[i + 1]?.date ?? addDays(start, 7)) <= 2 ? 1 : 2));
  const picks = pickSpread(
    mains,
    mainsFor.reduce((a, b) => a + b, 0),
  );
  const breakfasts = rank(profile, "breakfast", ratings, lastHad, spare, today);
  // A breakfast batch is worth it for three mornings or more; fewer, and the daily breakfast covers them.
  const batchBreakfast =
    sessions[0] && daysUntil(sessions[0].date, addDays(start, 7)) >= 3
      ? breakfasts.find((r) => !r.recipe.daily)?.recipe
      : undefined;
  const dailyBreakfast = breakfasts.find((r) => r.recipe.daily)?.recipe;
  const shakes = rank(profile, "shake", ratings, lastHad, spare, today)
    .slice(0, 3)
    .map((r) => r.recipe.key);
  const cooks: Cook[] = [];
  let used = 0;
  sessions.forEach((s, i) => {
    for (const r of picks.slice(used, used + mainsFor[i]))
      cooks.push({ id: `${s.date}-${r.key}`, recipe: r.key, date: s.date, start: s.start, portions: 0, scale: 1 });
    used += mainsFor[i];
  });
  if (batchBreakfast && sessions[0])
    cooks.push({
      id: `${sessions[0].date}-${batchBreakfast.key}`,
      recipe: batchBreakfast.key,
      date: sessions[0].date,
      start: sessions[0].start,
      portions: 0,
      scale: 1,
    });
  return {
    start,
    cooks,
    breakfast: dailyBreakfast?.key ?? batchBreakfast?.key ?? "",
    shake: shakes[0] ?? "",
    shakes,
    fresh: weekendFresh(profile, start, sessions, rank(profile, "main", ratings, lastHad, spare, today), today),
    out: [],
  };
}
