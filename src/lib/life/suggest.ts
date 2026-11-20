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
import { mainProtein, recipe, RECIPES, type Recipe } from "./recipes.ts";
import { firstShopFirst, lastFeedsUntil, type Cook, type Trip, type WeekMode, type WeekPlan } from "./planner.ts";
import { planCombo, type ComboSession, type Kitchen } from "./combo.ts";

export type Rating = { recipe: string; stars: number };
/** When each recipe was last eaten or cooked. */
export type LastHad = Record<string, string>;

export type Ranked = { recipe: Recipe; score: number; reasons: string[] };

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

/**
 * Picks n recipes from a ranking, spreading cuisines and meats, with at most one to
 * explore. `prior` are picks already made for the week, so the spread counts them too.
 */
export function pickSpread(ranked: Ranked[], n: number, avoid: string[] = [], prior: Recipe[] = []): Recipe[] {
  const chosen: Recipe[] = [...prior];
  const pool = ranked.filter((r) => !avoid.includes(r.recipe.key));
  while (chosen.length < prior.length + n && pool.length) {
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
  return chosen.slice(prior.length);
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

export function sessionDates(
  start: string,
  cooks: CookSession[],
): { date: string; start: number; minutes?: number | null }[] {
  const startWeekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return cooks
    .map((c) => ({
      date: addDays(start, (c.weekday - startWeekday + 7) % 7),
      start: c.start,
      ...(c.minutes ? { minutes: c.minutes } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

/**
 * Cook sessions already gone when the week is planned late are replaced by one
 * catch-up session today, so the plan never counts on food nobody cooked.
 */
export function catchUp<T extends { date: string; start: number }>(sessions: T[], today: string): T[] {
  const past = sessions.filter((x) => x.date < today);
  if (!past.length) return sessions;
  const future = sessions.filter((x) => x.date >= today);
  if (future.some((x) => x.date === today)) return future;
  return [{ ...past[past.length - 1], date: today, start: Math.max(...past.map((x) => x.start)) }, ...future];
}

/**
 * A whole week in one go: two mains per cook session, a breakfast batch on the
 * first session, a daily breakfast for the gaps, and the shake. Portions are left
 * at zero for sizeCooks to fill in. Given the kitchen, the mains are chosen as a set
 * that buys and wastes little (`planCombo`), and the plan says what it costs;
 * without it, they are the menu's top picks spread out.
 */
export function suggestWeek(
  profile: LifeProfile,
  start: string,
  ratings: Rating[],
  lastHad: LastHad,
  spare: Record<string, number>,
  today: string,
  mode: WeekMode = "batch",
  kitchen?: Kitchen & { cheaper?: boolean },
): WeekPlan {
  const plan =
    mode === "fresh"
      ? suggestFreshWeek(profile, start, ratings, lastHad, spare, today)
      : suggestBatchWeek(profile, start, ratings, lastHad, spare, today);
  if (!kitchen) return plan;
  const ranked = rank(profile, "main", ratings, lastHad, spare, today).filter(
    (r) => !r.recipe.tags.includes("weekend"),
  );
  return combine(plan, profile, ranked, today, kitchen);
}

/** The menu's picks replaced by the set planCombo chooses, in the same sessions. */
function combine(
  plan: WeekPlan,
  profile: LifeProfile,
  ranked: Ranked[],
  today: string,
  kitchen: Kitchen & { cheaper?: boolean },
): WeekPlan {
  const isMain = (c: Cook) => recipe(c.recipe)?.meal === "main";
  const mains = plan.cooks.filter(isMain);
  const times = catchUp(
    sessionDates(plan.start, plan.mode === "fresh" ? profile.routine.fresh.cooks : profile.routine.cooks),
    today,
  );
  const sessions: ComboSession[] = [];
  const greedy: Recipe[][] = [];
  for (const c of mains) {
    let i = sessions.findIndex((s) => s.date === c.date && s.start === c.start);
    if (i < 0) {
      const minutes = times.find((t) => t.date === c.date && t.start === c.start)?.minutes ?? null;
      i = sessions.push({ date: c.date, start: c.start, minutes, dishes: 0 }) - 1;
      greedy.push([]);
    }
    sessions[i].dishes++;
    greedy[i].push(recipe(c.recipe)!);
  }
  const rest = { ...plan, cooks: plan.cooks.filter((c) => !isMain(c)) };
  const found = planCombo({ week: rest, sessions, ranked, greedy, kitchen, cheaper: kitchen.cheaper });
  if (!found) return plan;
  const { cooks, ...cost } = found.week;
  return {
    ...plan,
    cooks: [...cooks, ...rest.cooks],
    cost: { ...cost, ...(found.cheaper ? { cheaper: found.cheaper.pence + found.cheaper.waste } : {}) },
  };
}

function suggestBatchWeek(
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

/**
 * A fresh week: one dish per short session, each feeding the days until the next,
 * so nothing has to wait in the freezer, and the routine's shop trips. A dish must
 * fit the session's time; rice dishes (one day in the fridge) go to sessions that
 * only cover a day. The last session also feeds next week's first meals, before
 * next week's first cook. The mornings use the daily breakfast, so no session cooks
 * two things.
 */
function suggestFreshWeek(
  profile: LifeProfile,
  start: string,
  ratings: Rating[],
  lastHad: LastHad,
  spare: Record<string, number>,
  today: string,
): WeekPlan {
  const until = lastFeedsUntil(start, "fresh", profile.routine);
  const ranked = rank(profile, "main", ratings, lastHad, spare, today).filter(
    (r) => !r.recipe.tags.includes("weekend"),
  );
  const sessions = catchUp(sessionDates(start, profile.routine.fresh.cooks), today);
  const picks: Recipe[] = [];
  const cooks: Cook[] = [];
  sessions.forEach((x, i) => {
    const covers = daysUntil(x.date, sessions[i + 1]?.date ?? until);
    const weeknight = (new Date(`${x.date}T00:00:00Z`).getUTCDay() + 6) % 7 < 5;
    const left = ranked.filter((r) => !picks.some((p) => p.key === r.recipe.key));
    const inTime = left.filter((r) => !x.minutes || r.recipe.totalMin <= x.minutes);
    // Dishes that stay safe in the fridge for every day the session feeds, when there are any.
    const safe = inTime.filter((r) => r.recipe.keeps.fridgeDays >= covers);
    const fits = (safe.length ? safe : inTime).map((r) => ({
      ...r,
      score: r.score - (weeknight ? r.recipe.activeMin / 20 : 0),
    }));
    // Nothing fits the time: the quickest dish left, rather than no cook at all.
    const pick =
      pickSpread(fits, 1, [], picks)[0] ?? [...left].sort((a, b) => a.recipe.totalMin - b.recipe.totalMin)[0]?.recipe;
    if (!pick) return;
    picks.push(pick);
    cooks.push({ id: `${x.date}-${pick.key}`, recipe: pick.key, date: x.date, start: x.start, portions: 0, scale: 1 });
  });
  const breakfasts = rank(profile, "breakfast", ratings, lastHad, spare, today);
  const dailyBreakfast = breakfasts.find((r) => r.recipe.daily)?.recipe ?? breakfasts[0]?.recipe;
  const shakes = rank(profile, "shake", ratings, lastHad, spare, today)
    .slice(0, 3)
    .map((r) => r.recipe.key);
  const trips: Trip[] = firstShopFirst(
    start,
    today,
    catchUp(sessionDates(start, profile.routine.fresh.trips), today).map((t) => ({
      id: `trip-${t.date}`,
      date: t.date,
      start: t.start,
    })),
  );
  return {
    start,
    mode: "fresh",
    cooks,
    trips,
    breakfast: dailyBreakfast?.key ?? "",
    shake: shakes[0] ?? "",
    shakes,
    fresh: weekendFresh(profile, start, sessions, rank(profile, "main", ratings, lastHad, spare, today), today),
    out: [],
  };
}
