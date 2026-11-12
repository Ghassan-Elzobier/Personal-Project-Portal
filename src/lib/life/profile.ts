// The owner's life settings: body, goal, food rules, routine. They live in the
// database (portal.life_profile), never in this public repo; these are only the
// shape, the neutral defaults a new profile starts from, and the validation that
// keeps a bad row from breaking a page. Pure, so it is tested.

import { NO_RULES, parseRules, type FoodRules } from "./allergens.ts";
import type { Cuisine, Kit } from "./recipes.ts";
import { BULK, type Goal } from "./nutrition.ts";

export type CookSession = { weekday: number; start: number };

export type LifeProfile = {
  body: { sex: "male" | "female" | null; birthYear: number | null; heightCm: number | null };
  goal: Goal & { kcalOverride: number | null; startedOn: string | null };
  /** Activity factor on resting energy: 1.4 desk job, 1.55 desk plus training, 1.7 on your feet. */
  activity: number;
  /** Maintenance learned from your weight, replacing the estimate once there is enough data. */
  learnedMaintenance: number | null;
  food: FoodRules;
  cuisines: Cuisine[];
  /** Recipe keys you love; they come round more often. */
  favourites: string[];
  /** 0 to 3: the hottest recipe to suggest. */
  spiceMax: number;
  kit: Kit[];
  routine: {
    /** Meal times, minutes after midnight. */
    breakfast: number;
    lunch: number;
    shake: number;
    dinner: number;
    /** Cook sessions; the first one starts the meal week. */
    cooks: CookSession[];
    /** Most days in a row the same lunch or dinner can come round. */
    maxRepeat: number;
    /** Lunch reheats at work, so lunch recipes must microwave well. */
    lunchAtWork: boolean;
  };
  gym: {
    /** 0 = Monday ... 6 = Sunday. */
    days: number[];
    start: number;
    minutes: number;
    benchGoalKg: number | null;
    /** The barbell lifts start lighter when you are returning after a break. */
    returning: boolean;
    /** Equipment the gym lacks, so exercises use their alternatives. */
    missing: string[];
  };
  shopping: { budgetPence: number | null; deliveryWeekday: number | null };
};

export const DEFAULT_PROFILE: LifeProfile = {
  body: { sex: null, birthYear: null, heightCm: null },
  goal: { ...BULK, kcalOverride: null, startedOn: null },
  activity: 1.55,
  learnedMaintenance: null,
  food: NO_RULES,
  cuisines: [],
  favourites: [],
  spiceMax: 2,
  kit: ["oven", "hob"],
  routine: {
    breakfast: 6 * 60,
    lunch: 12 * 60 + 30,
    shake: 16 * 60,
    dinner: 19 * 60,
    cooks: [
      { weekday: 6, start: 16 * 60 + 30 },
      { weekday: 2, start: 18 * 60 + 30 },
    ],
    maxRepeat: 3,
    lunchAtWork: true,
  },
  gym: { days: [0, 2, 4], start: 6 * 60 + 45, minutes: 75, benchGoalKg: null, returning: false, missing: [] },
  shopping: { budgetPence: null, deliveryWeekday: 5 },
};

const CUISINES: Cuisine[] = ["Italian", "Middle Eastern", "Chinese & SE Asian", "Indian", "Caribbean & West African", "British & American"];
const KIT: Kit[] = ["oven", "hob", "air fryer", "blender"];

function num(v: unknown, min: number, max: number, fallback: number): number;
function num(v: unknown, min: number, max: number, fallback: null): number | null;
function num(v: unknown, min: number, max: number, fallback: number | null): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function minutes(v: unknown, fallback: number): number {
  const n = num(v, 0, 24 * 60 - 5, fallback);
  return Math.round(n / 5) * 5;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function weekdays(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const days = [...new Set(v.map((d) => num(d, 0, 6, -1)).filter((d) => d >= 0))].sort();
  return days.length ? days : fallback;
}

/** A profile from whatever the database holds, with defaults for anything missing. */
export function parseProfile(raw: unknown): LifeProfile {
  const r = obj(raw);
  const d = DEFAULT_PROFILE;
  const body = obj(r.body);
  const goal = obj(r.goal);
  const routine = obj(r.routine);
  const gym = obj(r.gym);
  const shopping = obj(r.shopping);
  const cooks = Array.isArray(routine.cooks)
    ? routine.cooks
        .map((c) => obj(c))
        .map((c) => ({ weekday: num(c.weekday, 0, 6, -1), start: minutes(c.start, 18 * 60) }))
        .filter((c) => c.weekday >= 0)
        .slice(0, 4)
    : d.routine.cooks;
  return {
    body: {
      sex: body.sex === "male" || body.sex === "female" ? body.sex : null,
      birthYear: num(body.birthYear, 1920, 2015, null),
      heightCm: num(body.heightCm, 120, 230, null),
    },
    goal: {
      ratePct: num(goal.ratePct, -1, 1, d.goal.ratePct),
      proteinPerKg: num(goal.proteinPerKg, 0.8, 3, d.goal.proteinPerKg),
      fatShare: num(goal.fatShare, 0.15, 0.45, d.goal.fatShare),
      kcalOverride: num(goal.kcalOverride, 1200, 6000, null),
      startedOn: typeof goal.startedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(goal.startedOn) ? goal.startedOn : null,
    },
    activity: num(r.activity, 1.2, 2.2, d.activity),
    learnedMaintenance: num(r.learnedMaintenance, 1200, 6000, null),
    food: parseRules(r.food),
    cuisines: Array.isArray(r.cuisines) ? r.cuisines.filter((c): c is Cuisine => CUISINES.includes(c as Cuisine)) : [],
    favourites: Array.isArray(r.favourites) ? r.favourites.filter((f): f is string => typeof f === "string").slice(0, 50) : [],
    spiceMax: num(r.spiceMax, 0, 3, d.spiceMax),
    kit: Array.isArray(r.kit) ? r.kit.filter((k): k is Kit => KIT.includes(k as Kit)) : d.kit,
    routine: {
      breakfast: minutes(routine.breakfast, d.routine.breakfast),
      lunch: minutes(routine.lunch, d.routine.lunch),
      shake: minutes(routine.shake, d.routine.shake),
      dinner: minutes(routine.dinner, d.routine.dinner),
      cooks: cooks.length ? cooks : d.routine.cooks,
      maxRepeat: num(routine.maxRepeat, 1, 7, d.routine.maxRepeat),
      lunchAtWork: typeof routine.lunchAtWork === "boolean" ? routine.lunchAtWork : d.routine.lunchAtWork,
    },
    gym: {
      days: weekdays(gym.days, d.gym.days),
      start: minutes(gym.start, d.gym.start),
      minutes: num(gym.minutes, 30, 150, d.gym.minutes),
      benchGoalKg: num(gym.benchGoalKg, 20, 300, null),
      returning: typeof gym.returning === "boolean" ? gym.returning : d.gym.returning,
      missing: Array.isArray(gym.missing) ? gym.missing.filter((m): m is string => typeof m === "string").slice(0, 20) : [],
    },
    shopping: {
      budgetPence: num(shopping.budgetPence, 0, 100_000, null),
      deliveryWeekday: num(shopping.deliveryWeekday, 0, 6, null),
    },
  };
}

/** Age on a date, from the birth year (mid-year, so never more than six months out). */
export function ageOn(profile: LifeProfile, today: string): number | null {
  if (!profile.body.birthYear) return null;
  return Number(today.slice(0, 4)) - profile.body.birthYear - (Number(today.slice(5, 7)) < 7 ? 1 : 0);
}

/** True once there is enough to work out targets. */
export function isSetUp(p: LifeProfile): boolean {
  return Boolean(p.body.sex && p.body.birthYear && p.body.heightCm);
}
