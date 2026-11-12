// Nutrition: what a recipe gives you, what you need, and how the target learns.
//
// Targets start from the Mifflin-St Jeor equation (the best of the common
// equations for healthy adults, Frankenfield et al. 2005) times an activity factor.
// That start is only a guess, so the target then follows your weight: a trend
// smooths daily swings (an exponential moving average, as in The Hacker's Diet),
// and each week the target moves towards the gain rate you asked for.
//
// Defaults for gaining muscle: about 0.25 to 0.5% of body weight a week (Iraki
// et al. 2019, for natural lifters off-season), protein near 2 g/kg, since gains
// level off around 1.6 g/kg with an upper bound near 2.2 (Morton et al. 2018),
// and at least a quarter of energy from fat. Pure, so it is tested.

import { FORMS, type FoodRules, type Finding, judge, labelChecks, type Tag } from "./allergens.ts";
import { ingredient, INGREDIENTS, macrosOf, type Macros } from "./ingredients.ts";
import type { Recipe } from "./recipes.ts";

export const ZERO: Macros = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

export function add(a: Macros, b: Macros, times = 1): Macros {
  return {
    kcal: a.kcal + b.kcal * times,
    protein: a.protein + b.protein * times,
    fat: a.fat + b.fat * times,
    carbs: a.carbs + b.carbs * times,
  };
}

export function scale(a: Macros, k: number): Macros {
  return { kcal: a.kcal * k, protein: a.protein * k, fat: a.fat * k, carbs: a.carbs * k };
}

/** The whole batch as written, sides included. */
export function batchMacros(r: Recipe): Macros {
  return r.lines.reduce((sum, l) => add(sum, macrosOf(ingredient(l.item), l.qty, l.unit)), ZERO);
}

export function portionMacros(r: Recipe): Macros {
  return scale(batchMacros(r), 1 / r.portions);
}

// ---------------------------------------------------------------------------
// Can I eat it?
// ---------------------------------------------------------------------------

export type Verdict = {
  ok: boolean;
  /** Reasons it is off the menu. */
  blocked: Finding[];
  /** Allowed, and worth knowing (egg in a batter, a flagged food). */
  notes: Finding[];
  /** Ingredients whose label needs a look, with what to look for. */
  checks: { item: string; tags: Tag[] }[];
  /** Ingredients you said you dislike. */
  disliked: string[];
};

export function verdict(r: Recipe, rules: FoodRules): Verdict {
  const blocked: Finding[] = [];
  const notes: Finding[] = [];
  const checks: Verdict["checks"] = [];
  const disliked: string[] = [];
  for (const line of r.lines) {
    const item = INGREDIENTS.get(line.item);
    if (!item) continue;
    for (const tag of item.contains ?? []) {
      const form = line.form ?? "cooked";
      const f = judge(rules, tag, FORMS.includes(form) ? form : "cooked", item.name.toLowerCase());
      if (!f) continue;
      if (f.verdict === "blocked") blocked.push(f);
      else notes.push(f);
    }
    const tags = labelChecks(rules, item.watch);
    if (tags.length) checks.push({ item: item.name, tags });
    if (rules.dislikes.includes(item.key) || item.traits?.some((trait) => rules.avoidTraits.includes(trait))) disliked.push(item.name);
  }
  return { ok: blocked.length === 0, blocked, notes, checks, disliked };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type Body = { sex: "male" | "female"; age: number; heightCm: number; kg: number };
export type Goal = {
  /** Body weight to gain each week, as a percentage. Negative loses. */
  ratePct: number;
  proteinPerKg: number;
  /** Smallest share of energy from fat. */
  fatShare: number;
};

export const BULK: Goal = { ratePct: 0.4, proteinPerKg: 2.0, fatShare: 0.25 };

/** Resting energy, kcal a day (Mifflin-St Jeor). */
export function bmr(b: Body): number {
  return 10 * b.kg + 6.25 * b.heightCm - 5 * b.age + (b.sex === "male" ? 5 : -161);
}

/**
 * Energy stored in a kilo gained. Gaining as a lifter is part lean (about 1,000
 * kcal/kg) and part fat (about 9,400): Hall's model puts a mixed gain near 5,500.
 */
export const KCAL_PER_KG_GAINED = 5500;

export type Targets = { kcal: number; protein: number; fat: number; carbs: number; maintenance: number; source: "estimate" | "learned" };

/** Rounded to tidy numbers, since false precision helps nobody. */
export function targetsFor(b: Body, goal: Goal, activity: number, maintenanceOverride?: number): Targets {
  const maintenance = maintenanceOverride ?? bmr(b) * activity;
  const surplus = ((goal.ratePct / 100) * b.kg * KCAL_PER_KG_GAINED) / 7;
  const kcal = round(maintenance + surplus, 50);
  const protein = round(goal.proteinPerKg * b.kg, 5);
  const fat = round((kcal * goal.fatShare) / 9, 5);
  const carbs = round((kcal - protein * 4 - fat * 9) / 4, 5);
  return { kcal, protein, fat, carbs, maintenance: round(maintenance, 10), source: maintenanceOverride ? "learned" : "estimate" };
}

function round(n: number, step: number): number {
  return Math.round(n / step) * step;
}

// ---------------------------------------------------------------------------
// Weight trend and the weekly correction
// ---------------------------------------------------------------------------

export type Weight = { day: string; kg: number };

const DAY = 86_400_000;
const t = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The smoothed trend at each weigh-in: an exponential moving average with a tenth
 * of each day's difference, so a salty dinner barely moves it. Missing days decay
 * the weight of the old trend as if those days had been weighed at the trend.
 */
export function trend(weights: Weight[], alpha = 0.1): { day: string; kg: number; trend: number }[] {
  const sorted = [...weights].sort((a, b) => a.day.localeCompare(b.day));
  const out: { day: string; kg: number; trend: number }[] = [];
  let prev: { day: string; trend: number } | null = null;
  for (const w of sorted) {
    if (!prev) {
      prev = { day: w.day, trend: w.kg };
    } else {
      const gap = Math.max(1, Math.round((t(w.day) - t(prev.day)) / DAY));
      const keep = Math.pow(1 - alpha, gap);
      prev = { day: w.day, trend: prev.trend * keep + w.kg * (1 - keep) };
    }
    out.push({ day: w.day, kg: w.kg, trend: prev.trend });
  }
  return out;
}

/** kg a week, by least squares over the weigh-ins in the window. Null with too few. */
export function weeklyRate(weights: Weight[], today: string, days = 21, minPoints = 8): number | null {
  const from = t(today) - days * DAY;
  const pts = weights.filter((w) => t(w.day) > from && t(w.day) <= t(today)).map((w) => ({ x: (t(w.day) - from) / DAY, y: w.kg }));
  if (pts.length < minPoints) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  return slope * 7;
}

export type Adjustment = {
  /** kcal a day to add (negative to take away), or 0. */
  change: number;
  rate: number | null;
  wanted: number;
  why: string;
};

/**
 * The weekly nudge. Waits for two weeks of data (the first week's jump is mostly
 * glycogen, water and food in the gut, and creatine adds water too), then moves
 * the target by the energy the rate gap implies, never more than 150 kcal a week.
 * If you ate well under plan, it says so instead of raising a target you are not
 * eating.
 */
export function adjust(weights: Weight[], today: string, kg: number, goal: Goal, eatenShare: number | null, startedOn: string | null): Adjustment {
  const wanted = (goal.ratePct / 100) * kg;
  const rate = weeklyRate(weights, today, 21);
  const days = startedOn ? (t(today) - t(startedOn)) / DAY : 0;
  if (days < 14 || rate === null) {
    return { change: 0, rate, wanted, why: "Learning: the target starts adjusting after two weeks of weigh-ins." };
  }
  const gap = wanted - rate;
  if (Math.abs(gap) < 0.07) {
    return { change: 0, rate, wanted, why: "On pace. Keep eating the plan." };
  }
  if (gap > 0 && eatenShare !== null && eatenShare < 0.85) {
    return {
      change: 0,
      rate,
      wanted,
      why: `You ate about ${Math.round(eatenShare * 100)}% of the planned food. Eating the plan comes before raising it.`,
    };
  }
  const raw = (gap * KCAL_PER_KG_GAINED) / 7;
  const change = Math.max(-150, Math.min(150, Math.round(raw / 25) * 25));
  return {
    change,
    rate,
    wanted,
    why: gap > 0 ? `Gaining ${fmt(rate)} kg a week against ${fmt(wanted)}: adding ${change} kcal a day.` : `Gaining ${fmt(rate)} kg a week, faster than ${fmt(wanted)}: taking ${-change} kcal a day off.`,
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/** How a day's food splits across its slots. */
export const SPLIT = { breakfast: 0.22, lunch: 0.27, dinner: 0.29, shake: 0.22 } as const;
export type Slot = keyof typeof SPLIT;
export const SLOTS: Slot[] = ["breakfast", "lunch", "shake", "dinner"];

/**
 * How much bigger or smaller to make portions so one hits its slot's share.
 * Kept between three quarters and one and a half of the written size, so a
 * recipe still looks like itself.
 */
export function portionScale(r: Recipe, slotKcal: number): number {
  const per = portionMacros(r).kcal;
  if (per <= 0) return 1;
  const k = slotKcal / per;
  return Math.round(Math.min(1.5, Math.max(0.75, k)) * 20) / 20;
}
