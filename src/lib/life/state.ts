// Everything the Life pages show, worked out from what the database holds: the
// targets, this meal week, today's routine in order, and how the week is going.
// Pure, so it is tested; src/lib/life/load.ts reads the data and calls it.

import { addDays, weekdayIndex } from "../dates/week.ts";
import type { Tag } from "./allergens.ts";
import type { Unit } from "./ingredients.ts";
import { adjust, portionMacros, SPLIT, targetsFor, trend, type Adjustment, type Slot, type Targets, type Weight } from "./nutrition.ts";
import { ageOn, isSetUp, parseProfile, plannerRoutine, type LifeProfile } from "./profile.ts";
import { assign, mealWeekStart, reminders, type Placement, type Reminder, type WeekPlan } from "./planner.ts";
import { recipe } from "./recipes.ts";
import { weekNeeds, type Need, type Product, type StockRow } from "./shopping.ts";
import { consistency, nextWorkout, type SessionLog, type SetLog } from "./gym/progress.ts";
import { workout } from "./gym/program.ts";

export type MealLog = {
  day: string;
  slot: Slot;
  status: "eaten" | "skipped" | "swapped";
  recipe: string | null;
  batchGid: string | null;
  kcal: number | null;
  protein: number | null;
  note: string | null;
};

export type Batch = {
  gid: string;
  recipe: string;
  cookedOn: string;
  portions: number;
  remaining: number;
  scale: number;
  location: "fridge" | "freezer";
  planStart: string | null;
  cookId: string | null;
};

export type LifeRaw = {
  profile: unknown;
  weights: Weight[];
  plans: { start: string; data: WeekPlan }[];
  meals: MealLog[];
  batches: Batch[];
  ratings: { recipe: string; stars: number; note: string | null }[];
  lastHad: Record<string, string>;
  stock: StockRow[];
  products: Product[];
  sessions: SessionLog[];
  sets: SetLog[];
};

export type { Tag, Unit };

/** One meal week: its plan (if made), every meal placed, and the reminders. */
export type WeekView = { start: string; plan: WeekPlan | null; placements: Placement[]; reminders: Reminder[] };

export type LifeState = LifeRaw & {
  today: string;
  profile: LifeProfile;
  setUp: boolean;
  trend: { day: string; kg: number; trend: number }[];
  /** Today's trend weight, or the last weigh-in. */
  kg: number | null;
  targets: Targets | null;
  /** kcal the plan is sized for. */
  kcal: number;
  adjustment: Adjustment | null;
  weekStart: string;
  plan: WeekPlan | null;
  placements: Placement[];
  reminders: Reminder[];
  /** Batches with portions left. */
  open: Batch[];
  /** The meal week after this one, so it can be planned and shopped for ahead. */
  next: WeekView;
};

/** Batches the planner can draw on besides the plan's own cooks. */
function openForPlan(batches: Batch[], plan: WeekPlan | null) {
  // A batch made from this plan's cook is in the plan already: don't count it twice.
  return batches.filter((b) => b.remaining > 0 && !(plan && b.planStart === plan.start && b.cookId && plan.cooks.some((c) => c.id === b.cookId)));
}

export function buildState(raw: LifeRaw, today: string): LifeState {
  const profile = parseProfile(raw.profile);
  const setUp = isSetUp(profile);
  const tr = trend(raw.weights);
  const kg = tr.length ? Math.round(tr[tr.length - 1].trend * 10) / 10 : null;
  const age = ageOn(profile, today);
  const targets =
    setUp && kg !== null && age !== null
      ? targetsFor({ sex: profile.body.sex!, age, heightCm: profile.body.heightCm!, kg }, profile.goal, profile.activity, profile.learnedMaintenance ?? undefined)
      : null;
  const kcal = profile.goal.kcalOverride ?? targets?.kcal ?? 2600;
  const weekStart = mealWeekStart(today, profile.routine.cooks[0]?.weekday ?? 6);
  const plan = raw.plans.find((p) => p.start === weekStart)?.data ?? null;
  const open = raw.batches.filter((b) => b.remaining > 0);
  const place = (p: WeekPlan | null) => (p ? withCooked(assign(p, plannerRoutine(profile), openForPlan(raw.batches, p).map(toStock), kcal), raw.batches, p) : []);
  const placements = place(plan);
  const nextStart = addDays(weekStart, 7);
  const nextPlan = raw.plans.find((p) => p.start === nextStart)?.data ?? null;
  const nextPlacements = place(nextPlan);
  const eaten = eatenShare(raw.meals, today);
  const adjustment = setUp && kg !== null ? adjust(raw.weights, today, kg, profile.goal, eaten, profile.goal.startedOn) : null;
  return {
    ...raw,
    today,
    profile,
    setUp,
    trend: tr,
    kg,
    targets,
    kcal,
    adjustment,
    weekStart,
    plan,
    placements,
    reminders: plan ? reminders(plan, placements) : [],
    open,
    next: { start: nextStart, plan: nextPlan, placements: nextPlacements, reminders: nextPlan ? reminders(nextPlan, nextPlacements) : [] },
  };
}

/** This meal week, or the next one. */
export function weekView(s: LifeState, which: "this" | "next"): WeekView {
  return which === "next" ? s.next : { start: s.weekStart, plan: s.plan, placements: s.placements, reminders: s.reminders };
}

/** The meal week a date belongs to, for Today and the Schedule across the changeover. */
export function viewOn(s: LifeState, date: string): WeekView {
  return weekView(s, date >= s.next.start ? "next" : "this");
}

const toStock = (b: Batch) => ({ gid: b.gid, recipe: b.recipe, cookedOn: b.cookedOn, left: b.remaining, location: b.location, scale: b.scale });

/**
 * Once a planned cook is done, its placements point at the real batch (the
 * fridge or freezer one, as planned), so eating takes from it.
 */
function withCooked(placements: Placement[], batches: Batch[], plan: WeekPlan): Placement[] {
  const mine = batches.filter((b) => b.planStart === plan.start && b.cookId);
  return placements.map((p) => {
    if (!p.cookId) return p;
    const rows = mine.filter((b) => b.cookId === p.cookId);
    const b = rows.find((r) => r.location === (p.storage ?? "fridge")) ?? rows[0];
    return b ? { ...p, batchGid: b.gid } : p;
  });
}

/** Share of planned kcal eaten over the last two weeks, or null with too little logged. */
function eatenShare(meals: MealLog[], today: string): number | null {
  const from = addDays(today, -14);
  const recent = meals.filter((m) => m.day >= from && m.day < today);
  if (recent.length < 10) return null;
  const eaten = recent.filter((m) => m.status !== "skipped").length;
  return eaten / recent.length;
}

// ---------------------------------------------------------------------------
// Today, in order
// ---------------------------------------------------------------------------

export type RoutineItem = {
  key: string;
  time: number;
  kind: "weigh" | "meal" | "gym" | "cook" | "defrost" | "freeze" | "shop";
  title: string;
  detail: string;
  done: boolean;
  skipped?: boolean;
  href: string;
  slot?: Slot;
  placement?: Placement;
  workout?: string;
  cookId?: string;
};

export function routineFor(s: LifeState, date: string): RoutineItem[] {
  const items: RoutineItem[] = [];
  const v = viewOn(s, date);
  const weighed = s.weights.some((w) => w.day === date);
  items.push({ key: "weigh", time: s.profile.routine.breakfast - 10, kind: "weigh", title: "Weigh in", detail: weighed ? `${s.weights.find((w) => w.day === date)!.kg} kg` : "After the loo, before food", done: weighed, href: "/life/body" });
  for (const p of v.placements.filter((x) => x.date === date)) {
    const r = p.recipe ? recipe(p.recipe) : undefined;
    const log = s.meals.find((m) => m.day === date && m.slot === p.slot);
    const label = p.slot === "shake" ? "Shake" : p.slot.charAt(0).toUpperCase() + p.slot.slice(1);
    let detail = r ? r.name : p.source === "out" ? "Eating out" : "Nothing planned";
    if (p.storage === "freezer" && p.source !== "fresh") detail += " · from the freezer";
    items.push({ key: p.id, time: p.time, kind: "meal", title: label, detail, done: log?.status === "eaten" || log?.status === "swapped", skipped: log?.status === "skipped", href: r ? `/life/recipes/${r.key}` : "/life", slot: p.slot, placement: p });
  }
  if (s.profile.gym.days.includes(weekdayIndex(date))) {
    const session = s.sessions.find((x) => x.day === date);
    const key = session?.workout ?? nextWorkout(s.sessions.filter((x) => x.day < date));
    const w = workout(key);
    items.push({ key: "gym", time: s.profile.gym.start, kind: "gym", title: `Gym: ${w ? `${w.key}, ${w.name}` : key}`, detail: session?.finished ? "Done" : `${s.profile.gym.minutes} minutes`, done: Boolean(session?.finished), href: "/life/gym", workout: key });
  }
  for (const c of v.plan?.cooks.filter((x) => x.date === date) ?? []) {
    const r = recipe(c.recipe);
    if (!r) continue;
    const done = s.batches.some((b) => b.planStart === v.start && b.cookId === c.id);
    items.push({ key: `cook-${c.id}`, time: c.start, kind: "cook", title: `Cook ${r.name}`, detail: `${c.portions} portions · ${r.totalMin} min`, done, href: "/life/kitchen?tab=fridge", cookId: c.id });
  }
  for (const r of v.reminders.filter((x) => x.date === date && (x.kind === "defrost" || x.kind === "freeze"))) {
    items.push({ key: `${r.kind}-${r.time}-${r.text}`, time: r.time, kind: r.kind, title: r.kind === "defrost" ? "Defrost" : "Freeze", detail: r.text, done: false, href: "/life/kitchen?tab=fridge" });
  }
  return items.sort((a, b) => a.time - b.time || order(a.kind) - order(b.kind));
}

function order(k: RoutineItem["kind"]): number {
  return ["weigh", "meal", "gym", "cook", "freeze", "defrost", "shop"].indexOf(k);
}

/** Coming back from a break: the first two weeks from the first session are a rep easier. */
export function isReturning(s: LifeState, today: string): boolean {
  const first = s.sessions.map((x) => x.day).sort()[0];
  return s.profile.gym.returning && (!first || first >= addDays(today, -14));
}

/** The first thing not done yet, from now on, or the next thing left today. */
export function nextUp(items: RoutineItem[], minutes: number): RoutineItem | null {
  const open = items.filter((i) => !i.done && !i.skipped);
  return open.find((i) => i.time >= minutes - 60) ?? open[open.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Effort: the week so far
// ---------------------------------------------------------------------------

export type Effort = {
  train: { done: number; planned: number; streak: number };
  eat: { eaten: number; planned: number };
  protein: { hit: number; days: number };
  weigh: { done: number; days: number };
};

/** Monday to Sunday, like the rest of the portal. Days counted are those up to today. */
export function effort(s: LifeState, monday: string): Effort {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d <= s.today);
  const planned = s.placements.filter((p) => days.includes(p.date) && p.recipe && p.date < s.today);
  const eaten = planned.filter((p) => s.meals.some((m) => m.day === p.date && m.slot === p.slot && m.status !== "skipped")).length;
  const goal = s.targets?.protein ?? null;
  const proteinDays = days.filter((d) => d < s.today);
  const hit = goal ? proteinDays.filter((d) => s.meals.filter((m) => m.day === d && m.status !== "skipped").reduce((t, m) => t + (m.protein ?? 0), 0) >= goal * 0.9).length : 0;
  return {
    train: consistency(s.sessions, s.profile.gym.days, monday),
    eat: { eaten, planned: planned.length },
    protein: { hit, days: proteinDays.length },
    weigh: { done: s.weights.filter((w) => days.includes(w.day)).length, days: days.length },
  };
}

/** Planned meals on past days with nothing logged, for a one-tap "I ate them". */
export function unlogged(s: LifeState, before: string): Placement[] {
  const from = s.plan?.createdOn ?? s.plan?.start ?? before;
  return s.placements.filter((p) => p.date >= from && p.date < before && p.recipe && p.source !== "out" && !s.meals.some((m) => m.day === p.date && m.slot === p.slot));
}

/** What a week's food still needs: cooks not done yet and meals still to come. */
export function remainingNeeds(s: LifeState, v: WeekView = weekView(s, "this")): Need[] {
  if (!v.plan) return [];
  const cooked = new Set(s.batches.filter((b) => b.planStart === v.start && b.cookId).map((b) => b.cookId!));
  const eaten = new Set(s.meals.filter((m) => m.status !== "skipped").map((m) => `${m.day}:${m.slot}`));
  return weekNeeds(v.plan, v.placements, { cooked, eaten, from: s.today });
}

/** kcal and protein of one placed portion. */
export function placedMacros(p: Placement): { kcal: number; protein: number } | null {
  const r = p.recipe ? recipe(p.recipe) : undefined;
  if (!r) return null;
  let m = portionCache.get(r.key);
  if (!m) {
    m = portionMacros(r);
    portionCache.set(r.key, m);
  }
  return { kcal: Math.round(m.kcal * p.scale), protein: Math.round(m.protein * p.scale) };
}

const portionCache = new Map<string, { kcal: number; protein: number }>();

/** A day's planned kcal and protein against target. */
export function dayTotals(s: LifeState, date: string): { kcal: number; protein: number; target: number } {
  let kcal = 0;
  let protein = 0;
  for (const p of viewOn(s, date).placements.filter((x) => x.date === date)) {
    const m = placedMacros(p);
    if (m) {
      kcal += m.kcal;
      protein += m.protein;
    }
  }
  return { kcal, protein, target: s.kcal };
}

export { SPLIT };
