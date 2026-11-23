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
  fillGaps,
  firstShopFirst,
  cookScale,
  mealWeekStart,
  reminders,
  stillToEat,
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
  beforeShop,
  buildList,
  carryMissing,
  kitchenAfter,
  linesFor,
  listTotal,
  money,
  needsOf,
  packInItemUnit,
  spareUntil,
  splitTrips,
  usesOf,
  weekNeeds,
  type ListLine,
  type Need,
  type Product,
  type StockRow,
  type Use,
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

/**
 * Whether a batch was logged from a cook of the meal week starting `start` (from that
 * one cook, given `cookId`). No week (`start` missing) has no cooks.
 */
const fromCook = (b: Batch, start: string | null | undefined, cookId?: string) =>
  Boolean(start) && b.planStart === start && (cookId === undefined ? Boolean(b.cookId) : b.cookId === cookId);

/**
 * The batches logged from a meal week's cooks, or from one of them. A cook can make
 * more than one (a fridge and a freezer batch). This is the one answer to "is this
 * cook done?": a cook is done once it has a batch.
 */
export function cookBatches(s: { batches: Batch[] }, start: string | null | undefined, cookId?: string): Batch[] {
  return s.batches.filter((b) => fromCook(b, start, cookId));
}

/** The ids of a meal week's cooks that are done (see `cookBatches`). */
export function cookedIds(s: { batches: Batch[] }, start: string | null | undefined): Set<string> {
  return new Set(cookBatches(s, start).map((b) => b.cookId!));
}

/** A fresh week's shops, done or not; none for a week shopped any other way. */
export const freshTrips = (v: { plan: WeekPlan | null }) => (v.plan?.mode === "fresh" ? (v.plan.trips ?? []) : []);

/** A batch made from this plan's cook is in the plan already: don't count it twice. */
const ownBatch = (b: Batch, plan: WeekPlan | null) =>
  Boolean(plan && fromCook(b, plan.start) && plan.cooks.some((c) => c.id === b.cookId));

/** Batches the planner can draw on besides the plan's own cooks. */
function openForPlan(batches: Batch[], plan: WeekPlan | null) {
  return batches.filter((b) => b.remaining > 0 && !ownBatch(b, plan));
}

/** What a plan can draw on from the kitchen: its open batches, less what `taken` says earlier meals take. */
function stockLeft(batches: Batch[], plan: WeekPlan | null, taken = new Map<string, number>()): StockBatch[] {
  return openForPlan(batches, plan).map((b) => ({ ...toStock(b), left: b.remaining - (taken.get(b.gid) ?? 0) }));
}

/** Meals logged (eaten, skipped or swapped), as "date:slot". */
const loggedOf = (meals: MealLog[]) => new Set(meals.map((m) => `${m.day}:${m.slot}`));

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
  // A fresh week saved with its first shop after its first day gets it on that day.
  const plans = raw.plans.map((p) =>
    p.data.mode === "fresh" && p.data.trips
      ? { ...p, data: { ...p.data, trips: firstShopFirst(p.data.start, today, p.data.trips) } }
      : p,
  );
  const plan = plans.find((p) => p.start === weekStart)?.data ?? null;
  const open = raw.batches.filter((b) => b.remaining > 0);
  const place = (p: WeekPlan | null, taken?: Map<string, number>) =>
    p ? withCooked(assign(p, plannerRoutine(profile), stockLeft(raw.batches, p, taken), kcal), raw.batches, p) : [];
  const logged = loggedOf(raw.meals);
  // A portion this week's own cook made that no meal is down for any more (a meal
  // swapped or skipped) fills an empty lunch or dinner this week, then carries on.
  const placed = place(plan);
  const taking = stillToEat(placed, logged);
  const freed = plan
    ? cookBatches(raw, plan.start)
        .filter((b) => b.remaining > (taking.get(b.gid) ?? 0))
        .map((b) => ({ ...toStock(b), left: b.remaining - (taking.get(b.gid) ?? 0) }))
    : [];
  const placements = freed.length ? fillGaps(placed, freed, today) : placed;
  const nextStart = addDays(weekStart, 7);
  const nextPlan = plans.find((p) => p.start === nextStart)?.data ?? null;
  // Next week draws only on what this week's meals leave in each batch.
  const nextPlacements = place(nextPlan, stillToEat(placements, logged));
  const eaten = eatenShare(raw.meals, today);
  const adjustment =
    setUp && kg !== null ? adjust(raw.weights, today, kg, profile.goal, eaten, profile.goal.startedOn) : null;
  return {
    ...raw,
    plans,
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
    if (cook) return { cook, start: v.start, done: cookBatches(s, v.start, cookId).length > 0 };
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

/**
 * Cooked portions in the fridge and freezer a week's plan can really use, for sizing
 * its cooks and costing it. Next week gets what is left once this week's meals have
 * taken theirs. This week gets the batches not made from its own cooks, as the week
 * found them: portions eaten from them this week count, so a cook's size stays put
 * while the week eats into the kitchen.
 */
export function stockFor(s: LifeState, v: { start: string; plan: WeekPlan | null }): StockBatch[] {
  if (v.start > s.weekStart)
    return stockLeft(s.batches, v.plan, stillToEat(s.placements, loggedOf(s.meals))).filter((b) => b.left > 0);
  const end = addDays(v.start, 7);
  const eaten = new Map<string, number>();
  for (const m of s.meals)
    if (m.status === "eaten" && m.batchGid && m.day >= v.start && m.day < end)
      eaten.set(m.batchGid, (eaten.get(m.batchGid) ?? 0) + 1);
  return s.batches
    .filter((b) => !ownBatch(b, v.plan))
    .map((b) => ({ ...toStock(b), left: Math.min(b.portions, b.remaining + (eaten.get(b.gid) ?? 0)) }))
    .filter((b) => b.left > 0);
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
  const mine = cookBatches({ batches }, plan.start);
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
    const done = cookBatches(s, v.start, c.id).length > 0;
    items.push({
      key: `cook-${c.id}`,
      time: c.start,
      kind: "cook",
      title: `Cook ${r.name}`,
      detail: `${c.portions} portions · ${r.totalMin} min`,
      done,
      // The session's Cook view: get ready, each dish at the amounts the list bought, box up.
      href: `/life/cook?day=${c.date}&at=${c.start}`,
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

/**
 * Whether logging these cooks finishes this week's cooking while next week has no
 * plan yet, so next week can plan itself. Only a cook of this week's plan counts: a
 * week with nothing to cook, or a cook from next week, plans nothing.
 */
export function shouldPlanNext(s: LifeState, logging: string[]): boolean {
  const cooks = s.plan?.cooks ?? [];
  if (s.next.plan || !logging.some((id) => cooks.some((c) => c.id === id))) return false;
  const done = new Set([...cookedIds(s, s.weekStart), ...logging]);
  return cooks.every((c) => done.has(c.id));
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

/**
 * What a week's food still needs: cooks not done yet and meals still to come. `also`
 * counts a cook (by id) or a meal (`day:slot`) being logged right now as done.
 */
export function remainingNeeds(
  s: LifeState,
  v: WeekView = weekView(s, "this"),
  also: { cook?: string; meal?: string } = {},
): Need[] {
  if (!v.plan) return [];
  const cooked = cookedIds(s, v.start);
  const eaten = new Set(s.meals.filter((m) => m.status !== "skipped").map((m) => `${m.day}:${m.slot}`));
  if (also.cook) cooked.add(also.cook);
  if (also.meal) eaten.add(also.meal);
  return weekNeeds(v.plan, v.placements, { cooked, eaten, from: s.today });
}

/**
 * What this meal week and the next still need, for how long the cupboard's staples
 * will last. `also` leaves out what is being logged now: a cook in the week starting
 * `start`, or a meal (`day:slot`).
 */
export function needsAhead(s: LifeState, also: { start?: string; cook?: string; meal?: string } = {}): Need[] {
  return [weekView(s, "this"), s.next].flatMap((v) =>
    remainingNeeds(s, v, { meal: also.meal, cook: v.start === also.start ? also.cook : undefined }),
  );
}

/**
 * The kitchen as a meal week finds it. This week's is what is in now; next week's is
 * what this week leaves once its remaining cooks and meals have taken their share, so
 * nothing is counted for both weeks.
 */
export function kitchenFor(s: LifeState, v: WeekView): StockRow[] {
  if (v.start <= s.weekStart) return s.stock;
  const thisWeek = needsOf(usesOf([...remainingNeeds(s, weekView(s, "this")), ...carriedBack(s)]));
  return withSpare(kitchenAfter(s.stock, thisWeek), pendingSpare(s));
}

/** Open shops of a week, in order. */
const openTrips = (v: WeekView) =>
  freshTrips(v)
    .filter((t) => !t.doneOn)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

/**
 * Whether a use of next week's food goes on this week's last shop instead: it comes
 * before next week's first shop, and this week still has a shop before it (Saturday's
 * breakfast on Friday's shop). Null when there is nothing to carry.
 */
function carryRule(s: LifeState): ((u: Use) => boolean) | null {
  const last = openTrips(weekView(s, "this")).at(-1);
  const first = freshTrips(s.next)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0];
  if (!last || !first) return null;
  return (u) => beforeShop(u, first) && !beforeShop(u, last);
}

/** Next week's food that this week's last shop buys (see `carryRule`). */
export function carriedBack(s: LifeState): Need[] {
  const rule = carryRule(s);
  return rule ? needsOf(usesOf(remainingNeeds(s, s.next)).filter(({ use }) => rule(use))) : [];
}

/**
 * What this week's shops still to come will leave over, as kitchen rows: each pack's
 * rest beyond what it is bought for, with the date it goes off. Next week counts it,
 * so it isn't bought twice (pasta from Friday's shop, for Sunday's dinner).
 */
function pendingSpare(s: LifeState): StockRow[] {
  const v = weekView(s, "this");
  if (!v.plan) return [];
  const shops =
    v.plan.mode === "fresh"
      ? tripLists(s, v).open.map((t) => ({ date: t.trip.date, lines: t.lines }))
      : v.plan.shop?.deliveredOn
        ? []
        : [{ date: s.today, lines: buildList(remainingNeeds(s, v), s.stock, s.products, s.profile.food, s.today) }];
  return shops.flatMap(({ date, lines }) =>
    lines
      .filter((l) => l.packs > 0)
      .map((l): StockRow => {
        if (l.item.staple) return { item: l.item.key, qty: 0, status: "have", goodUntil: null };
        const rest = Math.max(0, l.have + l.packs * packInItemUnit(l.item, l.packQty, l.packUnit) - l.need);
        return {
          item: l.item.key,
          qty: rest,
          status: null,
          goodUntil: spareUntil({ ...l, spare: rest }, undefined, date),
        };
      }),
  );
}

/** Kitchen rows with a shop's spare added: an empty row takes the spare's date, a stocked one keeps its own. */
function withSpare(rows: StockRow[], spare: StockRow[]): StockRow[] {
  const out = new Map(rows.map((r) => [r.item, { ...r }]));
  for (const x of spare) {
    const row = out.get(x.item);
    if (!row) out.set(x.item, { ...x });
    else if (x.status === "have") row.status = "have";
    else {
      if (!(row.qty > 0)) row.goodUntil = x.goodUntil;
      row.qty += x.qty;
    }
  }
  return [...out.values()];
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
  const trips = freshTrips(v).filter((t) => t.date === date);
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
  const trips = freshTrips(v);
  const done = trips.filter((t) => t.doneOn);
  const open = trips.filter((t) => !t.doneOn);
  if (!open.length) return { open: [], done, covered: [] };
  // This week's last shop also buys next week's food wanted before next week's first shop.
  const rule = carryRule(s);
  const own = remainingNeeds(s, v);
  const needs = !rule
    ? own
    : v.start === s.weekStart
      ? needsOf(usesOf([...own, ...carriedBack(s)]))
      : v.start === s.next.start
        ? needsOf(usesOf(own).filter(({ use }) => !rule(use)))
        : own;
  const split = splitTrips(needs, open, kitchenFor(s, v), s.products);
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
