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
  } & ShopTicks;
  /** "fresh": short cooks of one dish and several small shops. Missing means batch. */
  mode?: WeekMode;
  /** A fresh week's shops, in date order. */
  trips?: Trip[];
  /** The day the plan was made: days before it are history, not missed meals. */
  createdOn?: string;
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
  /** The shop's estimate when it was done, for the week's total. */
  pence?: number;
} & ShopTicks;

/** A cupboard staple's status before a shop marked it "have", so Undo can put it back. */
export type StapleBefore = { item: string; status: "have" | "low" | "out" | null };

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
};

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
      const candidates = pools
        .filter((p) => p.left > 0 && p.recipe.meal === wantMeal && p.readyAt <= at)
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
 * In a fresh week, a cook's spare portions (for next week's first lunch) stay in
 * the fridge when they are still in date at the start of next week.
 */
export function spareStaysCold(plan: WeekPlan, c: Cook): boolean {
  const r = recipe(c.recipe);
  return Boolean(plan.mode === "fresh" && r && addDays(c.date, r.keeps.fridgeDays) >= addDays(plan.start, 7));
}

/**
 * Portions of a planned cook that go in the freezer: the ones planned from the freezer,
 * and the spare ones nobody is down to eat if the dish freezes, unless a fresh week's
 * last cook keeps them cold for next week's first lunch.
 */
export function freezeCount(plan: WeekPlan, c: Cook, placements: Placement[]): number {
  const placed = placements.filter((p) => p.cookId === c.id);
  const frozen = placed.filter((p) => p.storage === "freezer").length;
  const spareOnes = Math.max(0, c.portions - placed.length);
  return Math.min(c.portions, frozen + (recipe(c.recipe)?.keeps.freezes && !spareStaysCold(plan, c) ? spareOnes : 0));
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

/**
 * How many portions each cook should make: the lunches and dinners from when its
 * session is ready to when the next one is, split across the session's recipes,
 * plus the first lunch of the next week. Fresh meals and meals out are left out.
 */
export function sizeCooks(plan: WeekPlan, routine: Routine, kcal: number): Cook[] {
  const days = weekDays(plan.start);
  const fresh = new Set(plan.fresh.map((f) => slotId(f.date, f.slot)));
  const out = new Set(plan.out);
  const mains = plan.cooks.filter((c) => recipe(c.recipe)?.meal === "main");
  const sessions = [...new Set(mains.map((c) => minuteOf(plan.start, c.date, c.start)))].sort((a, b) => a - b);
  const slots: number[] = [];
  for (const date of [...days, addDays(plan.start, 7)]) {
    for (const slot of ["lunch", "dinner"] as Slot[]) {
      const id = slotId(date, slot);
      if (fresh.has(id) || out.has(id)) continue;
      // The next week's first lunch is in, so leftovers cover the gap before its first cook.
      if (date === addDays(plan.start, 7) && slot === "dinner") continue;
      slots.push(minuteOf(plan.start, date, routine[slot]));
    }
  }
  const sized = new Map<string, number>();
  sessions.forEach((at, i) => {
    const group = mains.filter((c) => minuteOf(plan.start, c.date, c.start) === at);
    const ready = at + Math.max(...group.map((c) => recipe(c.recipe)!.totalMin));
    const until =
      sessions[i + 1] !== undefined
        ? sessions[i + 1] +
          Math.max(
            ...mains
              .filter((c) => minuteOf(plan.start, c.date, c.start) === sessions[i + 1])
              .map((c) => recipe(c.recipe)!.totalMin),
          )
        : Infinity;
    const need = slots.filter((s) => s >= ready && s < until).length;
    const each = Math.floor(need / group.length);
    let extra = need - each * group.length;
    for (const c of group) {
      const n = Math.max(2, each + (extra > 0 ? 1 : 0));
      if (extra > 0) extra--;
      sized.set(c.id, n);
    }
  });
  return plan.cooks.map((c) => {
    const r = recipe(c.recipe);
    if (!r) return c;
    if (r.meal === "breakfast")
      return {
        ...c,
        portions: c.portions || breakfastPortions(plan, c, r),
        scale: portionScale(r, kcal * SPLIT.breakfast),
      };
    return { ...c, portions: sized.get(c.id) ?? c.portions, scale: cookScale(r, kcal) * (c.round ?? 1) };
  });
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
    if (r?.keeps.freezes && !(c && spareStaysCold(plan, c)))
      freezeByCook.set(s.cookId, (freezeByCook.get(s.cookId) ?? 0) + s.portions);
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
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time);
}
