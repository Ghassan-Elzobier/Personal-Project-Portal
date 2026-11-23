// Moving a shop. A fresh week's shops sit on the routine's days; when one is
// missed (or won't happen when planned), it moves, and the week follows it:
//
// - a cook session that needs food from this shop and would now start before the
//   food is home moves to after it: its own time that day when that is late
//   enough, or as soon as the food is put away (the next day at its own time when
//   that is too late at night), so the meals after it are fed from it instead
//   (the save sizes its portions again for the days it now feeds);
// - a meal cooked fresh from this shop that now comes first moves to the same
//   meal on the first later day that has room;
// - a shop it reaches (moving past it, or onto its day) is joined: one trip with
//   both lists.
//
// What a cook or meal needs from the kitchen, or from an earlier shop, keeps it
// where it is: only what this shop buys moves anything (`buys`, worked out by
// state.ts `tripLists`). The move remembers what it changed, so Undo puts it all
// back. Pure, so it is tested; the save is moveShop in operations.ts.

import { addDays, clock } from "../dates/week.ts";
import type { Slot } from "./nutrition.ts";
import { slotTime, type Routine, type Trip, type WeekPlan } from "./planner.ts";
import { recipe } from "./recipes.ts";
import type { Use } from "./shopping.ts";

/** How long a shop takes on the Schedule. */
export const SHOP_MINUTES = 30;
/** After a shop starts, the food is home and put away this much later: no cook it feeds starts sooner. */
const FOOD_IN = SHOP_MINUTES + 15;
/** A shop or a cook starts between these times, as a cook session's Move allows. */
export const EARLIEST = 6 * 60;
export const LATEST = 22 * 60;
const STEP = 15;

export type At = { date: string; start: number };

/** What a move changed, kept on the plan so Undo can put it back exactly. */
type MoveRecord = NonNullable<WeekPlan["lastMove"]>;

export type ShopMove = {
  plan: WeekPlan;
  /** The days of the shops it reached and took in. */
  joined: string[];
  /** Cook sessions moved to after it, a dish at a time. */
  cooks: { recipe: string; from: At; to: At }[];
  /** Meals cooked fresh moved to a later day. */
  fresh: { recipe: string; slot: Slot; from: string; to: string }[];
  /** Dishes that need this shop's food first and had nowhere later in the week to go: they stay, early on its list. */
  early: string[];
};

export type ShopMoveInput = {
  today: string;
  /** Minutes after midnight now, today. */
  now: number;
  /** The week's cooks already cooked, by id: they stay where they are. */
  cooked: Set<string>;
  /** What each open shop buys, as uses, by trip id (state.ts `tripLists`). */
  buys: Map<string, Use[]>;
  routine: Routine;
};

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const byTime = (a: At, b: At) => a.date.localeCompare(b.date) || a.start - b.start;
const up = (minutes: number) => Math.ceil(minutes / STEP) * STEP;

/** When a meal cooked fresh starts cooking: the cooking takes the recipe's time, the meal its last half hour. */
export function freshStart(time: number, totalMin: number): number {
  return time - (Math.max(SHOP_MINUTES, up(totalMin)) - SHOP_MINUTES);
}

/**
 * Moves one open shop of a fresh week to `to`, and the week with it (see the top
 * of this file). An error names what to pick instead; nothing is changed then.
 */
export function moveShop(plan: WeekPlan, tripId: string, to: At, input: ShopMoveInput): ShopMove | { error: string } {
  const trips = plan.mode === "fresh" ? (plan.trips ?? []) : [];
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return { error: "That shop isn't in this week's plan any more. Reload to see the week as it is." };
  if (trip.doneOn) return { error: "That shop is done already." };
  const last = addDays(plan.start, 6);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to.date) || to.date < plan.start || to.date > last)
    return { error: "Pick a day in this meal week." };
  if (!Number.isInteger(to.start) || to.start < EARLIEST || to.start > LATEST)
    return { error: "Pick a time between 06:00 and 22:00." };
  // A shop that would be over before now has gone already; one under way still counts.
  if (to.date < input.today || (to.date === input.today && to.start + SHOP_MINUTES <= input.now))
    return { error: "Pick a time still to come." };

  const minute = (a: At) => daysBetween(plan.start, a.date) * 1440 + a.start;
  const from = minute(trip);
  const at = minute(to);
  const [lo, hi] = from <= at ? [from, at] : [at, from];
  // The open shops it passes, or lands on the day of, become part of it.
  const joins = trips.filter(
    (t) => t !== trip && !t.doneOn && (t.date === to.date || (minute(t) >= lo && minute(t) <= hi)),
  );
  const union = (lists: (string[] | undefined)[]) => {
    const all = [...new Set(lists.flatMap((l) => l ?? []))];
    return all.length ? all : undefined;
  };
  const moved: Trip = {
    ...trip,
    date: to.date,
    start: to.start,
    moved: true,
    ticked: union([trip.ticked, ...joins.map((j) => j.ticked)]),
    missing: union([trip.missing, ...joins.map((j) => j.missing)]),
    via: trip.via ?? joins.find((j) => j.via)?.via,
  };
  for (const key of ["ticked", "missing", "via"] as const) if (moved[key] === undefined) delete moved[key];

  const record: MoveRecord = {
    trips: structuredClone(trips),
    cooks: plan.cooks.map((c) => ({ id: c.id, date: c.date, start: c.start })),
    fresh: structuredClone(plan.fresh),
  };
  const next: WeekPlan = structuredClone(plan);
  next.trips = [...trips.filter((t) => t !== trip && !joins.includes(t)), moved].sort(byTime);

  // What these shops buy, and from when the food is in.
  const uses = [trip, ...joins].flatMap((t) => input.buys.get(t.id) ?? []);
  const ready = at + FOOD_IN;
  const needs = (name: string, date: string, time: number) =>
    uses.some((u) => u.use === name && u.date === date && u.time === time);
  const early: string[] = [];

  // Cook sessions, whole: one that needs this shop's food and would start before it is in.
  const out: ShopMove["cooks"] = [];
  const sessions = new Map<string, typeof next.cooks>();
  for (const c of next.cooks) {
    if (input.cooked.has(c.id)) continue;
    const key = `${c.date}:${c.start}`;
    sessions.set(key, [...(sessions.get(key) ?? []), c]);
  }
  for (const group of sessions.values()) {
    const { date, start } = group[0];
    if (minute({ date, start }) >= ready) continue;
    if (!group.some((c) => needs(recipe(c.recipe)?.name ?? c.recipe, c.date, c.start))) continue;
    const dest = afterShop(to, start, to.start + FOOD_IN, last);
    if (!dest) {
      early.push(...group.map((c) => recipe(c.recipe)?.name ?? c.recipe));
      continue;
    }
    for (const c of group) {
      out.push({ recipe: c.recipe, from: { date: c.date, start: c.start }, to: dest });
      c.date = dest.date;
      c.start = dest.start;
    }
  }

  // Meals cooked fresh from this shop, now before it: the same meal on the first later day with room.
  const fresh: ShopMove["fresh"] = [];
  const taken = (date: string, slot: Slot) =>
    next.fresh.some((f) => f.date === date && f.slot === slot) || next.out.includes(`${date}:${slot}`);
  for (const f of [...next.fresh].sort((a, b) => a.date.localeCompare(b.date))) {
    const r = recipe(f.recipe);
    if (!r) continue;
    const time = slotTime(input.routine, f.date, f.slot);
    if (!needs(r.name, f.date, time)) continue;
    const cooking = (date: string) =>
      minute({ date, start: freshStart(slotTime(input.routine, date, f.slot), r.totalMin) });
    if (cooking(f.date) >= ready) continue;
    let dest: string | null = null;
    for (let d = to.date; d <= last; d = addDays(d, 1))
      if (cooking(d) >= ready && !taken(d, f.slot)) {
        dest = d;
        break;
      }
    if (!dest) {
      early.push(r.name);
      continue;
    }
    fresh.push({ recipe: f.recipe, slot: f.slot, from: f.date, to: dest });
    f.date = dest;
  }

  next.lastMove = record;
  return { plan: next, joined: joins.map((j) => j.date), cooks: out, fresh, early };
}

/**
 * Where a cook session goes once its shop moved: on the shop's day, at its own time
 * when the food is in by then, or as soon as it is (on the quarter hour). Too late
 * that night, it goes to the next day at its own time. Null past the week's end.
 */
function afterShop(shop: At, own: number, inBy: number, last: string): At | null {
  if (own >= inBy) return { date: shop.date, start: own };
  const soon = up(inBy);
  if (soon <= LATEST) return { date: shop.date, start: Math.max(soon, EARLIEST) };
  const tomorrow = addDays(shop.date, 1);
  return tomorrow <= last ? { date: tomorrow, start: own } : null;
}

/**
 * Puts the week back as it was before its last shop move: its shops, the cooks it
 * moved (those not cooked since) and its fresh meals. Null when there is nothing to
 * undo, or when a shop has been done since, whose food is in the kitchen now.
 */
export function undoMove(plan: WeekPlan, cooked: Set<string>): WeekPlan | null {
  const record = plan.lastMove;
  if (!record) return null;
  const doneNow = (plan.trips ?? []).filter((t) => t.doneOn).map((t) => t.id);
  const doneThen = new Set(record.trips.filter((t) => t.doneOn).map((t) => t.id));
  if (doneNow.some((id) => !doneThen.has(id))) return null;
  const back: WeekPlan = structuredClone(plan);
  back.trips = structuredClone(record.trips);
  for (const c of back.cooks) {
    const was = record.cooks.find((x) => x.id === c.id);
    if (was && !cooked.has(c.id)) {
      c.date = was.date;
      c.start = was.start;
    }
  }
  back.fresh = structuredClone(record.fresh);
  delete back.lastMove;
  return back;
}

/** "Moved to 18:00. Sunday's cook too, to 18:45." The words for what a move did, for its toast. */
export function moveSaid(m: Pick<ShopMove, "joined" | "cooks" | "fresh" | "early">, to: At, today: string): string {
  const day = (date: string) =>
    date === today
      ? "today"
      : date === addDays(today, 1)
        ? "tomorrow"
        : new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const when = (a: At) => `${day(a.date)} ${clock(a.start)}`;
  const parts = [
    `Shop moved to ${when(to)}${m.joined.length ? `, with ${m.joined.map(day).join(" and ")}'s shop` : ""}.`,
  ];
  const sessions = [...new Map(m.cooks.map((c) => [`${c.to.date}:${c.to.start}`, c])).values()];
  for (const c of sessions) {
    const names = m.cooks.filter((x) => x.to.date === c.to.date && x.to.start === c.to.start);
    const what = names.map((x) => recipe(x.recipe)?.name ?? x.recipe).join(" and ");
    parts.push(`${what} moves to ${when(c.to)}.`);
  }
  for (const f of m.fresh) parts.push(`${recipe(f.recipe)?.name ?? f.recipe} moves to ${day(f.to)}'s ${f.slot}.`);
  if (m.early.length) parts.push(`${m.early.join(" and ")} still needs it first: move that in the Kitchen.`);
  return parts.join(" ");
}
