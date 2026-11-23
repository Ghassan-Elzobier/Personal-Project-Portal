// The meal week: which batch feeds which meal, and what goes in the freezer.
//
// A meal week starts on the first cook day (Sunday by default) and runs seven
// days, so the first cook feeds the days after it. Each lunch and dinner is filled
// in time order from whatever is cooked and still safe, oldest first, never the
// same dish more than `maxRepeat` days running, and lunch and dinner differ when
// they can. Safety is the Food Standards Agency's: cooked food keeps 2 days in the
// fridge and rice 1, so a portion eaten later is frozen once cool and moved to the
// fridge the evening before. Pure, so it is tested.

import { addDays, weekdayIndex } from "../dates/week.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { portionScale, SPLIT, type Slot } from "./nutrition.ts";
import { recipe, type Recipe } from "./recipes.ts";

export type Cook = {
  id: string;
  recipe: string;
  date: string;
  /** Minutes after midnight the session starts. */
  start: number;
  portions: number;
  /** Portion size against the recipe as written, so every portion of a batch is the same. */
  scale: number;
  /** Portions this much bigger than the target (at most 1.15), to finish a whole pack. */
  round?: number;
  /** Why the planner picked it, in a few words. */
  why?: string[];
  /**
   * A week's last cook: how many of its portions are for next week's lunches and
   * dinners before next week's first cook and still in date then, so they stay in the
   * fridge rather than the freezer (`keptCold`).
   */
  forNextWeek?: number;
};

export type WeekPlan = {
  /** First day of the meal week. */
  start: string;
  cooks: Cook[];
  /** Made fresh each morning when no breakfast batch is ready. */
  breakfast: string;
  shake: string;
  /** Shakes taken in turn, one a day, so they don't get boring. Falls back to `shake`. */
  shakes?: string[];
  /** Cooked and eaten at the meal, like a Saturday steak. */
  fresh: { date: string; slot: Slot; recipe: string }[];
  /** Slots you won't eat at home: "2026-11-15:dinner". */
  out: string[];
  /** Delivery and order state, for a batch week's one shop. */
  shop?: {
    orderedOn?: string;
    /** The trolley total at Sainsbury's checkout, when you typed it. */
    orderedPence?: number;
    deliveredOn?: string;
    got?: string[];
    added?: { item: string; qty: number }[];
    restore?: StapleBefore[];
    dropped?: DroppedBefore[];
    dates?: DateBefore[];
    frozen?: FrozenOnArrival[];
  } & ShopTicks;
  /** "fresh": short cooks of one dish and several small shops. Missing means batch. */
  mode?: WeekMode;
  /**
   * Planned with two days or fewer left, for just those days: fresh dinners and one
   * shop, no cooks (`suggestShortWeek`). Its mode is "fresh", for the shop.
   */
  short?: boolean;
  /** A fresh week's shops, in date order. */
  trips?: Trip[];
  /**
   * Planned by itself once the week before's last cook was logged (`shouldPlanNext`),
   * so the pages can say so. A re-plan by the owner leaves it off.
   */
  auto?: boolean;
  /** The day the plan was made: days before it are history, not missed meals. */
  createdOn?: string;
  /**
   * What the last shop move changed (shop-move.ts), so Undo puts the week's shops, the
   * cooks it moved and its fresh meals back as they were.
   */
  lastMove?: { trips: Trip[]; cooks: { id: string; date: string; start: number }[]; fresh: WeekPlan["fresh"] };
  /**
   * What the week costs as planned, before any of it is bought (pence, and fresh food
   * left to go off), and the cheapest week the planner found then (packs plus waste).
   */
  cost?: {
    pence: number;
    cupboard: number;
    waste: number;
    items: number;
    trips: number;
    kcal: number;
    cheaper?: number;
  };
};

export type WeekMode = "batch" | "fresh";

/** One shop in a fresh week, and what it brought home once done. */
export type Trip = {
  id: string;
  date: string;
  /** Minutes after midnight. */
  start: number;
  doneOn?: string;
  got?: string[];
  added?: { item: string; qty: number }[];
  restore?: StapleBefore[];
  dropped?: DroppedBefore[];
  dates?: DateBefore[];
  frozen?: FrozenOnArrival[];
  /** The shop's estimate when it was done, for the week's total. */
  pence?: number;
  /** Put on this day and time by the owner (shop-move.ts), so nothing moves it back. */
  moved?: boolean;
} & ShopTicks;

/** A cupboard staple's status before a shop marked it "have", so Undo can put it back. */
export type StapleBefore = { item: string; status: "have" | "low" | "out" | null };

/** Food past its date a shop's fresh pack replaced, so Undo can put it back as it was. */
export type DroppedBefore = { item: string; qty: number; goodUntil: string | null };

/** A use-by a shop moved, so Undo can put the old one back. */
export type DateBefore = { item: string; goodUntil: string | null };

/** Fresh food a shop put straight in the freezer, and the day it is first wanted, for a defrost reminder. */
export type FrozenOnArrival = { item: string; for: string };

/**
 * What has gone in the basket (in person) or the trolley (online), and what the shop
 * didn't have. `via` is the way the ticks were made, so the list opens that way again.
 */
export type ShopTicks = { ticked?: string[]; missing?: string[]; via?: ShopVia };

/** Shopping in person with the list, or ordering online from it. */
export type ShopVia = "store" | "online";

/** A cooked batch with portions left, from the kitchen. */
export type StockBatch = {
  gid: string;
  recipe: string;
  cookedOn: string;
  left: number;
  location: "fridge" | "freezer";
  scale: number;
};

export type Placement = {
  id: string;
  date: string;
  slot: Slot;
  time: number;
  recipe: string | null;
  source: "cook" | "stock" | "daily" | "fresh" | "out" | "none";
  cookId?: string;
  batchGid?: string;
  cookedOn?: string;
  storage?: "fridge" | "freezer";
  /** Move from freezer to fridge on the evening of this date. */
  defrostOn?: string;
  /** How much bigger or smaller than written the portion is. */
  scale: number;
};

export type Routine = {
  breakfast: number;
  lunch: number;
  shake: number;
  dinner: number;
  maxRepeat: number;
  lunchAtWork: boolean;
  /** On these weekdays (0 = Monday) the shake comes straight after training, which ends at gymEnd. */
  gymDays?: number[];
  gymEnd?: number;
  /** The routine's cook sessions for a batch week and a fresh one, so a week knows when next week's first cook is. */
  cooks?: RoutineCook[];
  fresh?: { cooks: RoutineCook[] };
  /** Weekend dinners the routine cooks fresh (0 to 2), on Saturday then Sunday when no session falls there. */
  weekendFresh?: number;
};

/** A cook session in the routine: weekday (0 = Monday), start, and the minutes it may take. */
type RoutineCook = { weekday: number; start: number; minutes?: number | null };

/** When a slot is eaten on a date. */
export function slotTime(routine: Routine, date: string, slot: Slot): number {
  if (slot === "shake" && routine.gymEnd !== undefined && routine.gymDays?.includes(weekdayIndex(date)))
    return Math.min(23 * 60, routine.gymEnd + 10);
  return routine[slot];
}

export const slotId = (date: string, slot: Slot) => `${date}:${slot}`;

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The meal week a date falls in, given the weekday (0 = Monday) the week starts on. */
export function mealWeekStart(date: string, startWeekday: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -((weekday - startWeekday + 7) % 7));
}

type Pool = {
  key: string;
  recipe: Recipe;
  cookedOn: string;
  /** Minute of the week (relative to plan start) the food is ready. */
  readyAt: number;
  left: number;
  scale: number;
  location: "plan" | "fridge" | "freezer";
  cookId?: string;
  batchGid?: string;
};

const minuteOf = (start: string, date: string, minutes: number) => daysBetween(start, date) * 1440 + minutes;

/** Safe to eat on this date, and where it has to wait until then. */
function storageFor(p: Pool, date: string): "fridge" | "freezer" | null {
  const age = daysBetween(p.cookedOn, date);
  if (p.location === "freezer") return "freezer";
  if (age <= p.recipe.keeps.fridgeDays) return "fridge";
  // Already sitting in the fridge past its window: no longer safe.
  if (p.location === "fridge") return null;
  return p.recipe.keeps.freezes ? "freezer" : null;
}

/** Fill every slot of the week. */
export function assign(plan: WeekPlan, routine: Routine, stock: StockBatch[], kcal: number): Placement[] {
  const days = weekDays(plan.start);
  const pools: Pool[] = [];
  for (const b of stock) {
    const r = recipe(b.recipe);
    if (r && b.left > 0)
      pools.push({
        key: `b${b.gid}`,
        recipe: r,
        cookedOn: b.cookedOn,
        readyAt: -Infinity,
        left: b.left,
        scale: b.scale,
        location: b.location,
        batchGid: b.gid,
      });
  }
  for (const c of plan.cooks) {
    const r = recipe(c.recipe);
    if (r && c.portions > 0)
      pools.push({
        key: `c${c.id}`,
        recipe: r,
        cookedOn: c.date,
        readyAt: minuteOf(plan.start, c.date, c.start) + r.totalMin,
        left: c.portions,
        scale: c.scale,
        location: "plan",
        cookId: c.id,
      });
  }
  const fresh = new Map(plan.fresh.map((f) => [slotId(f.date, f.slot), f.recipe]));
  const out = new Set(plan.out);
  const placements: Placement[] = [];
  const history: Record<Slot, string[]> = { breakfast: [], lunch: [], shake: [], dinner: [] };

  for (const [dayIndex, date] of days.entries()) {
    for (const slot of ["breakfast", "lunch", "shake", "dinner"] as Slot[]) {
      const time = slotTime(routine, date, slot);
      const id = slotId(date, slot);
      const base = { id, date, slot, time };
      const target = kcal * SPLIT[slot];
      if (out.has(id)) {
        placements.push({ ...base, recipe: null, source: "out", scale: 1 });
        history[slot].push("");
        continue;
      }
      const freshKey = fresh.get(id);
      if (freshKey && recipe(freshKey)) {
        placements.push({ ...base, recipe: freshKey, source: "fresh", scale: portionScale(recipe(freshKey)!, target) });
        history[slot].push(freshKey);
        continue;
      }
      if (slot === "shake") {
        const key = plan.shakes?.length ? plan.shakes[dayIndex % plan.shakes.length] : plan.shake;
        placements.push({ ...base, recipe: key, source: "daily", scale: scaleOf(key, target) });
        continue;
      }
      const at = minuteOf(plan.start, date, time);
      const wantMeal = slot === "breakfast" ? "breakfast" : "main";
      const sameDay =
        slot === "dinner" ? placements.find((p) => p.date === date && p.slot === "lunch")?.recipe : undefined;
      const recent = history[slot];
      // Days before the plan was made are history: food in the kitchen is kept for the
      // meals still to come, not placed on a lunch that is gone (a week planned late).
      const past = plan.createdOn !== undefined && date < plan.createdOn;
      const candidates = pools
        .filter((p) => p.left > 0 && p.recipe.meal === wantMeal && p.readyAt <= at && !(past && p.location !== "plan"))
        .map((p) => ({ p, storage: storageFor(p, date) }))
        .filter((c): c is { p: Pool; storage: "fridge" | "freezer" } => c.storage !== null)
        .map((c) => {
          const run = trailing(recent, c.p.recipe.key);
          // Lower is better, compared in order.
          const rank = [
            run >= routine.maxRepeat ? 1 : 0,
            slot === "lunch" && routine.lunchAtWork && c.p.recipe.tags.includes("weekend") ? 1 : 0,
            sameDay === c.p.recipe.key ? 1 : 0,
            // Food that can't wait goes first: fridge-only, closing soonest.
            c.p.recipe.keeps.freezes || c.p.location === "freezer" ? 1 : 0,
            daysBetween(c.p.cookedOn, date) <= c.p.recipe.keeps.fridgeDays ? 0 : 1,
            Date.parse(c.p.cookedOn),
            run,
          ];
          return { ...c, rank };
        })
        .sort((a, b) => compare(a.rank, b.rank));
      const pick = candidates[0];
      if (pick) {
        pick.p.left -= 1;
        const fromPlan = pick.p.location === "plan";
        placements.push({
          ...base,
          recipe: pick.p.recipe.key,
          source: fromPlan ? "cook" : "stock",
          cookId: pick.p.cookId,
          batchGid: pick.p.batchGid,
          cookedOn: pick.p.cookedOn,
          storage: pick.storage,
          defrostOn: pick.storage === "freezer" ? addDays(date, -1) : undefined,
          scale: pick.p.scale,
        });
        history[slot].push(pick.p.recipe.key);
        continue;
      }
      if (slot === "breakfast") {
        placements.push({ ...base, recipe: plan.breakfast, source: "daily", scale: scaleOf(plan.breakfast, target) });
        history[slot].push(plan.breakfast);
        continue;
      }
      placements.push({ ...base, recipe: null, source: "none", scale: 1 });
      history[slot].push("");
    }
  }
  return placements;
}

/**
 * Cooked portions nobody is down to eat (a meal swapped or skipped) fill the week's
 * empty lunches and dinners from `from` on, soonest first, while they are still in
 * date: fridge portions within their fridge days, freezer ones the day after a
 * defrost reminder. Portions left over carry to next week.
 */
export function fillGaps(placements: Placement[], stock: StockBatch[], from: string): Placement[] {
  const left = stock.map((b) => ({ ...b })).filter((b) => b.left > 0 && recipe(b.recipe)?.meal === "main");
  return placements.map((p) => {
    if (p.source !== "none" || (p.slot !== "lunch" && p.slot !== "dinner") || p.date < from) return p;
    const b = left
      .filter((x) => x.left > 0)
      .filter((x) => x.location === "freezer" || daysBetween(x.cookedOn, p.date) <= recipe(x.recipe)!.keeps.fridgeDays)
      .sort(
        (a, b2) =>
          Number(a.location === "freezer") - Number(b2.location === "freezer") || a.cookedOn.localeCompare(b2.cookedOn),
      )[0];
    if (!b) return p;
    b.left -= 1;
    return {
      ...p,
      recipe: b.recipe,
      source: "stock",
      batchGid: b.gid,
      cookedOn: b.cookedOn,
      storage: b.location,
      defrostOn: b.location === "freezer" ? addDays(p.date, -1) : undefined,
      scale: b.scale,
    };
  });
}

/** How many portions this week's meals still take from each batch: placed from it, with nothing logged. */
export function stillToEat(placements: Placement[], logged: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of placements)
    if (p.batchGid && !logged.has(`${p.date}:${p.slot}`)) out.set(p.batchGid, (out.get(p.batchGid) ?? 0) + 1);
  return out;
}

/** Lunch and dinner share a batch, so its portions aim between their two shares. */
export function cookScale(r: Recipe, kcal: number): number {
  return portionScale(r, (kcal * (SPLIT.lunch + SPLIT.dinner)) / 2);
}

function scaleOf(key: string, target: number): number {
  const r = recipe(key);
  return r ? portionScale(r, target) : 1;
}

function trailing(list: string[], key: string): number {
  let n = 0;
  for (let i = list.length - 1; i >= 0 && list[i] === key; i--) n++;
  return n;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * A week's shops with the first one on the week's first day (or today, for a week
 * already running), before its first meals, when the routine's first shop day is
 * later: a week from Saturday with shops on Sunday and Wednesday shops on Saturday
 * and Wednesday. Left alone once any shop is done, when the first shop is in time, or
 * when the owner moved it there.
 */
export function firstShopFirst(start: string, today: string, trips: Trip[]): Trip[] {
  if (!trips.length || trips.some((t) => t.doneOn)) return trips;
  const firstDay = start > today ? start : today;
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  if (sorted[0].date <= firstDay || sorted[0].moved) return trips;
  return trips.map((t) => (t === sorted[0] ? { ...t, date: firstDay } : t));
}

/**
 * How many of a cook's spare portions stay in the fridge for next week's first meals.
 * A fresh week keeps its spare cold while it is still in date at the start of next
 * week; a batch week keeps cold the ones its last cook makes for next week's meals
 * before its first cook that are still in date then (`forNextWeek`).
 */
export function keptCold(plan: WeekPlan, c: Cook, spareOnes: number): number {
  const r = recipe(c.recipe);
  if (!r) return 0;
  if (plan.mode === "fresh") return addDays(c.date, r.keeps.fridgeDays) >= addDays(plan.start, 7) ? spareOnes : 0;
  return Math.min(spareOnes, c.forNextWeek ?? 0);
}

/**
 * Portions of a planned cook that go in the freezer: the ones planned from the freezer,
 * and the spare ones nobody is down to eat if the dish freezes, less those the week's
 * last cook keeps cold for next week's first meals.
 */
export function freezeCount(plan: WeekPlan, c: Cook, placements: Placement[]): number {
  const placed = placements.filter((p) => p.cookId === c.id);
  const frozen = placed.filter((p) => p.storage === "freezer").length;
  const spareOnes = Math.max(0, c.portions - placed.length);
  const spareFrozen = recipe(c.recipe)?.keeps.freezes ? spareOnes - keptCold(plan, c, spareOnes) : 0;
  return Math.min(c.portions, frozen + spareFrozen);
}

/** Portions left in each planned cook once the week is filled: these go to the freezer. */
export function spare(plan: WeekPlan, placements: Placement[]): { cookId: string; recipe: string; portions: number }[] {
  return plan.cooks
    .map((c) => ({
      cookId: c.id,
      recipe: c.recipe,
      portions: c.portions - placements.filter((p) => p.cookId === c.id).length,
    }))
    .filter((s) => s.portions > 0);
}

/** A week's cook sessions from the routine, in order, each with when its food can be ready. */
function routineSessions(start: string, cooks: RoutineCook[]): { date: string; at: number }[] {
  return cooks
    .map((c) => ({ date: addDays(start, (c.weekday - weekdayIndex(start) + 7) % 7), at: c.start + (c.minutes ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
}

/**
 * Next week's lunches and dinners before its first cook, for this week's last cook to
 * feed. Next week's first cook is the routine's, for the same kind of week; a weekend
 * dinner the routine cooks fresh is left out. Without the routine's sessions, next
 * week's first lunch.
 */
export function beforeNextCook(
  start: string,
  mode: WeekMode | undefined,
  routine: Routine,
): { date: string; slot: Slot }[] {
  const next = addDays(start, 7);
  const cooks = mode === "fresh" ? routine.fresh?.cooks : routine.cooks;
  if (!cooks?.length) return [{ date: next, slot: "lunch" }];
  const sessions = routineSessions(next, cooks);
  const days = weekDays(next);
  const freshDinners = [...days.filter((d) => weekdayIndex(d) === 5), ...days.filter((d) => weekdayIndex(d) === 6)]
    .filter((d) => !sessions.some((x) => x.date === d))
    .slice(0, routine.weekendFresh ?? 0);
  const out: { date: string; slot: Slot }[] = [];
  for (const date of days)
    for (const slot of ["lunch", "dinner"] as const) {
      if (date > sessions[0].date || (date === sessions[0].date && routine[slot] >= sessions[0].at)) return out;
      if (!(slot === "dinner" && freshDinners.includes(date))) out.push({ date, slot });
    }
  return out;
}

/** The last day a week's last session feeds: next week's last meal before its first cook, or next week's start. */
export function lastFeedsUntil(start: string, mode: WeekMode | undefined, routine: Routine): string {
  const end = addDays(start, 7);
  const last = beforeNextCook(start, mode, routine).at(-1)?.date;
  return last && last > end ? last : end;
}

/**
 * How many portions each cook should make: the lunches and dinners from when its
 * session is ready to when the next one is, split across the session's recipes.
 * Fresh meals and meals out are left out. The last session also makes next week's
 * lunches and dinners before its first cook (`beforeNextCook`): the first of them
 * always, frozen if it must be, and the rest while they are still in date, which it
 * keeps cold for them (`forNextWeek`).
 *
 * Cooked portions already in the kitchen (`stock`) are eaten first where the week
 * puts them (`assign`), so a session makes that many fewer for its days, spread
 * across its dishes and never under 2 a dish: no extra portions to freeze as spare,
 * and nothing bought for them.
 */
export function sizeCooks(plan: WeekPlan, routine: Routine, kcal: number, stock: StockBatch[] = []): Cook[] {
  const days = weekDays(plan.start);
  const fresh = new Set(plan.fresh.map((f) => slotId(f.date, f.slot)));
  const out = new Set(plan.out);
  const mains = plan.cooks.filter((c) => recipe(c.recipe)?.meal === "main");
  const sessions = [...new Set(mains.map((c) => minuteOf(plan.start, c.date, c.start)))].sort((a, b) => a - b);
  const slots: number[] = [];
  for (const date of days) {
    for (const slot of ["lunch", "dinner"] as Slot[]) {
      const id = slotId(date, slot);
      if (fresh.has(id) || out.has(id)) continue;
      slots.push(minuteOf(plan.start, date, routine[slot]));
    }
  }
  const last = mains.filter((c) => minuteOf(plan.start, c.date, c.start) === sessions.at(-1));
  const inDate = (c: Cook, date: string) => daysBetween(c.date, date) <= recipe(c.recipe)!.keeps.fridgeDays;
  const ahead = beforeNextCook(plan.start, plan.mode, routine).filter(
    (x, i) => i === 0 || last.some((c) => inDate(c, x.date)),
  );
  for (const x of ahead) slots.push(minuteOf(plan.start, x.date, routine[x.slot]));
  // Each of those meals still in date goes to a dish of the last session that keeps for it, in turn.
  const share = new Map<string, number>();
  ahead.forEach((x, i) => {
    const fits = last.filter((c) => inDate(c, x.date));
    if (fits.length) share.set(fits[i % fits.length].id, (share.get(fits[i % fits.length].id) ?? 0) + 1);
  });
  const readyOf = (at: number) =>
    at +
    Math.max(
      ...mains.filter((c) => minuteOf(plan.start, c.date, c.start) === at).map((c) => recipe(c.recipe)!.totalMin),
    );
  /** Each session's dishes, and the minutes from when it is ready to when the next one is. */
  const windows = sessions.map((at, i) => ({
    group: mains.filter((c) => minuteOf(plan.start, c.date, c.start) === at),
    ready: readyOf(at),
    until: sessions[i + 1] !== undefined ? readyOf(sessions[i + 1]) : Infinity,
  }));
  const sized = new Map<string, number>();
  for (const { group, ready, until } of windows) {
    const need = slots.filter((s) => s >= ready && s < until).length;
    const each = Math.floor(need / group.length);
    let extra = need - each * group.length;
    for (const c of group) {
      const n = Math.max(2, each + (extra > 0 ? 1 : 0));
      if (extra > 0) extra--;
      sized.set(c.id, n);
    }
  }
  const withSizes = (sizes: Map<string, number>) =>
    plan.cooks.map((c) => {
      const r = recipe(c.recipe);
      if (!r) return c;
      if (r.meal === "breakfast")
        return {
          ...c,
          portions: c.portions || breakfastPortions(plan, c, r),
          scale: portionScale(r, kcal * SPLIT.breakfast),
        };
      const main: Cook = { ...c, portions: sizes.get(c.id) ?? c.portions, scale: cookScale(r, kcal) * (c.round ?? 1) };
      // Its share of next week's first meals that are still in date then stays in the fridge.
      if (last.includes(c)) main.forNextWeek = share.get(c.id) ?? 0;
      else delete main.forNextWeek;
      return main;
    });
  const cooks = withSizes(sized);
  if (!stock.some((b) => b.left > 0) || !windows.length) return cooks;

  // Lunches and dinners each session's days take from the kitchen, as the week places them.
  const placed = assign({ ...plan, cooks }, routine, stock, kcal);
  const minute = (p: Placement) => minuteOf(plan.start, p.date, p.time);
  const isMeal = (p: Placement) => p.slot === "lunch" || p.slot === "dinner";
  const fewer = new Map(sized);
  for (const w of windows) {
    let n = placed.filter(
      (p) => isMeal(p) && p.source === "stock" && minute(p) >= w.ready && minute(p) < w.until,
    ).length;
    while (n > 0) {
      const most = w.group.filter((c) => fewer.get(c.id)! > 2).sort((a, b) => fewer.get(b.id)! - fewer.get(a.id)!)[0];
      if (!most) break;
      fewer.set(most.id, fewer.get(most.id)! - 1);
      n--;
    }
  }
  // Smaller cooks can shift which meal takes what: a lunch or dinner that would now
  // go without gets a portion back from the latest smaller session ready for it.
  const before = new Map(placed.map((p) => [p.id, p.source]));
  const smaller = (c: Cook) => fewer.get(c.id)! < sized.get(c.id)!;
  for (let guard = 0; guard < 50; guard++) {
    const again = assign({ ...plan, cooks: withSizes(fewer) }, routine, stock, kcal);
    const gap = again.find((p) => isMeal(p) && p.source === "none" && before.get(p.id) !== "none");
    const w = gap && windows.findLast((x) => x.ready <= minute(gap) && x.group.some(smaller));
    if (!w) break;
    const least = w.group.filter(smaller).sort((a, b) => fewer.get(a.id)! - fewer.get(b.id)!)[0];
    fewer.set(least.id, fewer.get(least.id)! + 1);
  }
  return withSizes(fewer);
}

/**
 * A breakfast batch covers the mornings after it is made (cooking happens later
 * in the day than breakfast) until it runs out of fridge, or the week if it freezes.
 */
function breakfastPortions(plan: WeekPlan, c: Cook, r: Recipe): number {
  const left = 6 - daysBetween(plan.start, c.date);
  return r.keeps.freezes ? Math.max(1, left) : Math.max(1, Math.min(left, r.keeps.fridgeDays));
}

export type Reminder = { date: string; time: number; text: string; kind: "defrost" | "freeze" | "cook" | "shop" };

/** What to do and when: freeze portions after cooking, defrost the night before. */
export function reminders(plan: WeekPlan, placements: Placement[]): Reminder[] {
  const out: Reminder[] = [];
  const name = (k: string | null) => recipe(k ?? "")?.name ?? "it";
  const freezeByCook = new Map<string, number>();
  for (const p of placements) {
    if (p.storage === "freezer" && p.defrostOn) {
      out.push({
        date: p.defrostOn,
        time: 21 * 60,
        kind: "defrost",
        text: `Move ${name(p.recipe)} from the freezer to the fridge for tomorrow's ${p.slot}.`,
      });
    }
    if (p.storage === "freezer" && p.source === "cook" && p.cookId)
      freezeByCook.set(p.cookId, (freezeByCook.get(p.cookId) ?? 0) + 1);
  }
  for (const s of spare(plan, placements)) {
    const r = recipe(s.recipe);
    const c = plan.cooks.find((x) => x.id === s.cookId);
    const n = r?.keeps.freezes ? s.portions - (c ? keptCold(plan, c, s.portions) : 0) : 0;
    if (n > 0) freezeByCook.set(s.cookId, (freezeByCook.get(s.cookId) ?? 0) + n);
  }
  for (const c of plan.cooks) {
    const n = freezeByCook.get(c.id);
    const r = recipe(c.recipe);
    if (!r) continue;
    out.push({
      date: c.date,
      time: c.start,
      kind: "cook",
      text: `Cook ${r.name}: ${c.portions} ${c.portions === 1 ? "portion" : "portions"}.`,
    });
    if (n)
      out.push({
        date: c.date,
        time: c.start + r.totalMin + 30,
        kind: "freeze",
        text: `Freeze ${n} ${n === 1 ? "portion" : "portions"} of ${r.name} once cool${r.keeps.rice ? " (within an hour: rice)" : ""}.`,
      });
  }
  // Fresh food a shop froze on arrival thaws in the fridge overnight (FSA), the evening before it's wanted.
  for (const f of [...(plan.shop?.frozen ?? []), ...(plan.trips ?? []).flatMap((t) => t.frozen ?? [])]) {
    const ing = INGREDIENTS.get(f.item);
    if (!ing) continue;
    out.push({
      date: addDays(f.for, -1),
      time: 21 * 60,
      kind: "defrost",
      text: `Move the ${ing.name.toLowerCase()} from the freezer to the fridge tonight, for tomorrow.`,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time);
}
