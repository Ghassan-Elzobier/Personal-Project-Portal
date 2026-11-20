// Everything the Life pages show, worked out from what the database holds: the
// targets, this meal week, today's routine in order, and how the week is going.
// Pure, so it is tested; src/lib/life/load.ts reads the data and calls it.

import { addDays, weekdayIndex } from "../dates/week.ts";
import {
  adjust,
  portionMacros,
  portionScale,
  SPLIT,
  targetsFor,
  trend,
  type Adjustment,
  type Slot,
  type Targets,
  type Weight,
} from "./nutrition.ts";
import { ageOn, isSetUp, parseProfile, plannerRoutine, type LifeProfile } from "./profile.ts";
import {
  assign,
  cookScale,
  mealWeekStart,
  reminders,
  type Cook,
  type Placement,
  type Reminder,
  type StockBatch,
  type Trip,
  type WeekPlan,
} from "./planner.ts";
import { recipe, type Recipe } from "./recipes.ts";
import { INGREDIENTS } from "./ingredients.ts";
import {
  buildList,
  carryMissing,
  kitchenAfter,
  linesFor,
  listTotal,
  money,
  splitTrips,
  weekNeeds,
  type ListLine,
  type Need,
  type Product,
  type StockRow,
} from "./shopping.ts";
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
  return batches.filter(
    (b) =>
      b.remaining > 0 && !(plan && b.planStart === plan.start && b.cookId && plan.cooks.some((c) => c.id === b.cookId)),
  );
}

export function buildState(raw: LifeRaw, today: string): LifeState {
  const profile = parseProfile(raw.profile);
  const setUp = isSetUp(profile);
  const tr = trend(raw.weights);
  const kg = tr.length ? Math.round(tr[tr.length - 1].trend * 10) / 10 : null;
  const age = ageOn(profile, today);
  const targets =
    setUp && kg !== null && age !== null
      ? targetsFor(
          { sex: profile.body.sex!, age, heightCm: profile.body.heightCm!, kg },
          profile.goal,
          profile.activity,
          profile.learnedMaintenance ?? undefined,
        )
      : null;
  const kcal = profile.goal.kcalOverride ?? targets?.kcal ?? 2600;
  const weekStart = mealWeekStart(today, profile.routine.cooks[0]?.weekday ?? 6);
  const plan = raw.plans.find((p) => p.start === weekStart)?.data ?? null;
  const open = raw.batches.filter((b) => b.remaining > 0);
  const place = (p: WeekPlan | null) =>
    p
      ? withCooked(assign(p, plannerRoutine(profile), openForPlan(raw.batches, p).map(toStock), kcal), raw.batches, p)
      : [];
  const placements = place(plan);
  const nextStart = addDays(weekStart, 7);
  const nextPlan = raw.plans.find((p) => p.start === nextStart)?.data ?? null;
  const nextPlacements = place(nextPlan);
  const eaten = eatenShare(raw.meals, today);
  const adjustment =
    setUp && kg !== null ? adjust(raw.weights, today, kg, profile.goal, eaten, profile.goal.startedOn) : null;
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
    next: {
      start: nextStart,
      plan: nextPlan,
      placements: nextPlacements,
      reminders: nextPlan ? reminders(nextPlan, nextPlacements) : [],
    },
  };
}

/** This meal week, or the next one. */
export function weekView(s: LifeState, which: "this" | "next"): WeekView {
  return which === "next"
    ? s.next
    : { start: s.weekStart, plan: s.plan, placements: s.placements, reminders: s.reminders };
}

/** A planned cook of this recipe, this meal week or the next, and whether it is cooked. */
export function plannedCook(
  s: LifeState,
  recipeKey: string,
  cookId: string,
): { cook: Cook; start: string; done: boolean } | null {
  for (const v of [weekView(s, "this"), s.next]) {
    const cook = v.plan?.cooks.find((c) => c.id === cookId && c.recipe === recipeKey);
    if (cook)
      return { cook, start: v.start, done: s.batches.some((b) => b.planStart === v.start && b.cookId === cookId) };
  }
  return null;
}

/**
 * The portions and amounts a recipe page shows. Opened from a planned cook, they
 * are that cook's: its portions at its size, pack round-up included, which are the
 * amounts the shopping list bought and "Cooked it" takes out of the cupboard.
 * Otherwise the recipe as written, sized to the target.
 */
export function recipeAmounts(s: LifeState, r: Recipe, ask: { cook?: string; portions?: number } = {}) {
  const planned = ask.cook ? plannedCook(s, r.key, ask.cook) : null;
  const scale =
    planned?.cook.scale ??
    (r.meal === "main"
      ? cookScale(r, s.kcal)
      : portionScale(r, s.kcal * (r.meal === "shake" ? SPLIT.shake : SPLIT.breakfast)));
  const wanted = ask.portions;
  const portions =
    wanted !== undefined && Number.isInteger(wanted) && wanted >= 1 && wanted <= 20
      ? wanted
      : (planned?.cook.portions ?? r.portions);
  return {
    planned,
    scale,
    portions,
    lines: linesFor(r, portions, scale),
    /** Portions changed from the plan's, so the amounts no longer match the list. */
    changed: planned !== null && portions !== planned.cook.portions,
  };
}

/** The meal week a date belongs to, for Today and the Schedule across the changeover. */
export function viewOn(s: LifeState, date: string): WeekView {
  return weekView(s, date >= s.next.start ? "next" : "this");
}

/** Cooked portions in the fridge and freezer, as a new week's plan would draw on them. */
export function openStock(s: LifeState): StockBatch[] {
  return openForPlan(s.batches, null).map(toStock);
}

const toStock = (b: Batch): StockBatch => ({
  gid: b.gid,
  recipe: b.recipe,
  cookedOn: b.cookedOn,
  left: b.remaining,
  location: b.location,
  scale: b.scale,
});

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
  items.push({
    key: "weigh",
    time: s.profile.routine.breakfast - 10,
    kind: "weigh",
    title: "Weigh in",
    detail: weighed ? `${s.weights.find((w) => w.day === date)!.kg} kg` : "After the loo, before food",
    done: weighed,
    href: "/life/body",
  });
  for (const p of v.placements.filter((x) => x.date === date)) {
    const r = p.recipe ? recipe(p.recipe) : undefined;
    const log = s.meals.find((m) => m.day === date && m.slot === p.slot);
    const label = p.slot === "shake" ? "Shake" : p.slot.charAt(0).toUpperCase() + p.slot.slice(1);
    let detail = r ? r.name : p.source === "out" ? "Eating out" : "Nothing planned";
    if (p.storage === "freezer" && p.source !== "fresh") detail += " · from the freezer";
    items.push({
      key: p.id,
      time: p.time,
      kind: "meal",
      title: label,
      detail,
      done: log?.status === "eaten" || log?.status === "swapped",
      skipped: log?.status === "skipped",
      href: r ? `/life/recipes/${r.key}` : "/life",
      slot: p.slot,
      placement: p,
    });
  }
  if (s.profile.gym.days.includes(weekdayIndex(date))) {
    const session = s.sessions.find((x) => x.day === date);
    const key = session?.workout ?? nextWorkout(s.sessions.filter((x) => x.day < date));
    const w = workout(key);
    items.push({
      key: "gym",
      time: s.profile.gym.start,
      kind: "gym",
      title: `Gym: ${w ? `${w.key}, ${w.name}` : key}`,
      detail: session?.finished ? "Done" : `${s.profile.gym.minutes} minutes`,
      done: Boolean(session?.finished),
      href: "/life/gym",
      workout: key,
    });
  }
  for (const c of v.plan?.cooks.filter((x) => x.date === date) ?? []) {
    const r = recipe(c.recipe);
    if (!r) continue;
    const done = s.batches.some((b) => b.planStart === v.start && b.cookId === c.id);
    items.push({
      key: `cook-${c.id}`,
      time: c.start,
      kind: "cook",
      title: `Cook ${r.name}`,
      detail: `${c.portions} portions · ${r.totalMin} min`,
      done,
      // The recipe at the amounts the list bought for this cook.
      href: `/life/recipes/${c.recipe}?cook=${encodeURIComponent(c.id)}`,
      cookId: c.id,
    });
  }
  for (const shop of shopsOn(s, v, date)) {
    items.push({
      key: `shop-${shop.trip.id}`,
      time: shop.trip.start,
      kind: "shop",
      title: "Shop",
      detail: shop.done ? "Done" : shop.list,
      done: shop.done,
      href: shop.href,
    });
  }
  for (const r of v.reminders.filter((x) => x.date === date && (x.kind === "defrost" || x.kind === "freeze"))) {
    items.push({
      key: `${r.kind}-${r.time}-${r.text}`,
      time: r.time,
      kind: r.kind,
      title: r.kind === "defrost" ? "Defrost" : "Freeze",
      detail: r.text,
      done: false,
      href: "/life/kitchen?tab=fridge",
    });
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
  const eaten = planned.filter((p) =>
    s.meals.some((m) => m.day === p.date && m.slot === p.slot && m.status !== "skipped"),
  ).length;
  const goal = s.targets?.protein ?? null;
  const proteinDays = days.filter((d) => d < s.today);
  const hit = goal
    ? proteinDays.filter(
        (d) =>
          s.meals.filter((m) => m.day === d && m.status !== "skipped").reduce((t, m) => t + (m.protein ?? 0), 0) >=
          goal * 0.9,
      ).length
    : 0;
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
  return s.placements.filter(
    (p) =>
      p.date >= from &&
      p.date < before &&
      p.recipe &&
      p.source !== "out" &&
      !s.meals.some((m) => m.day === p.date && m.slot === p.slot),
  );
}

/** What a week's food still needs: cooks not done yet and meals still to come. */
export function remainingNeeds(s: LifeState, v: WeekView = weekView(s, "this")): Need[] {
  if (!v.plan) return [];
  const cooked = new Set(s.batches.filter((b) => b.planStart === v.start && b.cookId).map((b) => b.cookId!));
  const eaten = new Set(s.meals.filter((m) => m.status !== "skipped").map((m) => `${m.day}:${m.slot}`));
  return weekNeeds(v.plan, v.placements, { cooked, eaten, from: s.today });
}

/**
 * The kitchen as a meal week finds it. This week's is what is in now; next week's is
 * what this week leaves once its remaining cooks and meals have taken their share, so
 * nothing is counted for both weeks.
 */
export function kitchenFor(s: LifeState, v: WeekView): StockRow[] {
  return v.start <= s.weekStart ? s.stock : kitchenAfter(s.stock, remainingNeeds(s, weekView(s, "this")));
}

export type TripList = {
  trip: Trip;
  lines: ListLine[];
  early: string[];
  /** What this shop didn't have, and the shop it moved to (null: none left this week). */
  notFound: { line: ListLine; to: string | null }[];
};

type ShopOn = { trip: Trip; done: boolean; list: string; href: string };

/**
 * A fresh week's shops on a day, for Today and the Schedule: each one done, and
 * each one still to do that has something to buy, with its list in a few words
 * ("6 items, about £14.20"). `open` saves working the lists out again.
 */
export function shopsOn(s: LifeState, v: WeekView, date: string, open?: () => TripList[]): ShopOn[] {
  const trips = v.plan?.mode === "fresh" ? (v.plan.trips ?? []).filter((t) => t.date === date) : [];
  if (!trips.length) return [];
  const lists = open ? open() : tripLists(s, v).open;
  const href = v.start === s.weekStart ? "/life/kitchen" : "/life/kitchen?week=next";
  return trips.flatMap((trip): ShopOn[] => {
    if (trip.doneOn) return [{ trip, done: true, list: "", href }];
    const lines = lists.find((x) => x.trip.id === trip.id)?.lines ?? [];
    const buying = lines.filter((l) => l.packs > 0);
    if (!buying.length) return [];
    const total = listTotal(lines);
    const count = `${buying.length} ${buying.length === 1 ? "item" : "items"}`;
    return [{ trip, done: false, list: `${count}, ${total.estimated ? "about " : ""}${money(total.pence)}`, href }];
  });
}

/**
 * A fresh week's shops: a list for each one not done yet, from what the week still
 * needs, and the ones already done. What a shop didn't have moves to the next one.
 * The page and the Done action both use this, so what you tick is what goes into
 * the kitchen.
 */
export function tripLists(s: LifeState, v: WeekView): { open: TripList[]; done: Trip[]; covered: string[] } {
  const trips = v.plan?.mode === "fresh" ? (v.plan.trips ?? []) : [];
  const done = trips.filter((t) => t.doneOn);
  const open = trips.filter((t) => !t.doneOn);
  if (!open.length) return { open: [], done, covered: [] };
  const split = splitTrips(remainingNeeds(s, v), open, kitchenFor(s, v), s.products);
  const carried = carryMissing(split.trips, Object.fromEntries(open.map((t) => [t.id, t.missing ?? []])));
  // Fresh food has come off already; staples still need their have / low / out.
  const staples = s.stock.filter((x) => INGREDIENTS.get(x.item)?.staple);
  return {
    open: carried.trips.map((t) => ({
      trip: open.find((o) => o.id === t.id)!,
      lines: buildList(t.needs, staples, s.products, s.profile.food, t.date),
      early: t.early,
      notFound: carried.moved
        .filter((m) => m.from === t.id)
        .flatMap((m) =>
          buildList([m.need], staples, s.products, s.profile.food, t.date).map((line) => ({ line, to: m.to })),
        ),
    })),
    done,
    covered: split.covered,
  };
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
