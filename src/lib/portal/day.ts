// Your day on Today: the Schedule's day in order, with what each item needs from
// you. Study, events and the Life plan come from the blocks the Schedule shows,
// at the same times, so the two always agree. Life adds what only it knows:
// whether a meal is eaten, what a cook makes and whether it is done, and the
// defrost and freeze reminders. Pure, so it is tested.

import { MORNING, nextFreeSlot, type Taken } from "../calendar/free-slot.ts";
import { LIFE_KINDS, type LifeKind } from "../calendar/life-blocks.ts";
import { addDays, clock, weekdayIndex } from "../dates/week.ts";
import { plan as gymPlan } from "../life/gym/duration.ts";
import { workout } from "../life/gym/program.ts";
import { consistency, nextWorkout } from "../life/gym/progress.ts";
import type { Slot } from "../life/nutrition.ts";
import type { Cook, Trip } from "../life/planner.ts";
import { recipe } from "../life/recipes.ts";
import { EARLIEST, LATEST, SHOP_MINUTES } from "../life/shop-move.ts";
import {
  cookedIds,
  freshTrips,
  placedMacros,
  routineFor,
  shopsOn,
  tripLists,
  viewOn,
  type LifeState,
  type RoutineItem,
} from "../life/state.ts";
import type { Block } from "./schedule.ts";

export type DayItem = {
  key: string;
  start: number;
  end: number;
  kind: "weigh" | "meal" | "gym" | "cook" | "defrost" | "freeze" | "shop" | "study" | "event" | "life";
  title: string;
  detail: string;
  done: boolean;
  skipped: boolean;
  href: string;
  /** Opens outside the portal: a Google Calendar event. */
  external?: boolean;
  /** A meal with a recipe, so it can be ticked as eaten. */
  slot?: Slot;
  /** A cook session's planned cooks not cooked yet. */
  cookIds?: string[];
  /** The task a study block is on, for Log. */
  taskGid?: string;
  /** Why it moved for a clash, or why it could not. */
  note?: string;
  clash?: boolean;
  /** A study block that has ended with no session logged for its task since it began. */
  missed?: boolean;
  /** Where a missed block could go: the next free time, as one tap. */
  move?: Move;
  /** The block's own day, when it is not today's: a study block or a shop carried from earlier in the week. */
  date?: string;
  /** A fresh week's shop: which one, so a missed one can move. */
  tripId?: string;
};

/** A session the owner logged, placed in the portal's time zone. */
export type SessionLog = { taskGid: string; date: string; minutes: number };

/**
 * A move one tap makes, and what the button says: a study block's goes to the
 * Schedule's own action as it is; a shop's to Life's, which moves the week with it.
 */
export type Move = {
  source: "asana" | "session" | "shop" | "cook";
  id: string;
  date: string;
  start: number;
  duration: number;
  label: string;
  /** A shop's or a cook session's meal week. */
  week?: string;
  /** A cook session's own day and time, which name it for the move. */
  from?: { date: string; at: number };
};

/** What Today knows beyond the blocks: this week's session logs, and the last day whose blocks it holds. */
export type Kept = { logs: SessionLog[]; lastDay: string };

export type Day = {
  items: DayItem[];
  nextKey: string | null;
  summary: string | null;
  planStart: string | null;
  /** Shops, cooks and study blocks missed on earlier days this week, still owed, each with a new time. */
  carried: DayItem[];
  /** Carried blocks beyond the few Today lists: they are on the Schedule. */
  carriedMore: number;
};

/** At most this many earlier misses on Today, so it stays a nudge and not a backlog. */
export const CARRIED_MAX = 3;

const ORDER: DayItem["kind"][] = [
  "shop",
  "weigh",
  "meal",
  "gym",
  "study",
  "event",
  "life",
  "cook",
  "freeze",
  "defrost",
];

/**
 * The day, from the Schedule's blocks for it and the Life state. Without blocks
 * (the Schedule could not be read) the Life items stand alone at their planned times.
 */
export function yourDay(
  date: string,
  blocks: Block[] | null,
  s: LifeState | null,
  now: number,
  kept: Kept | null = null,
): Day {
  const routine = s ? routineFor(s, date) : [];
  const v = s ? viewOn(s, date) : null;
  const items: DayItem[] = [];
  let carried: DayItem[] = [];
  let carriedMore = 0;
  // The Schedule's time, shared by every offer below so no two are offered the same time.
  const taken: Taken[] = (blocks ?? []).map((b) => ({ date: b.date, start: b.start, end: b.end }));

  if (blocks) {
    for (const b of blocks.filter((x) => x.date === date)) items.push(fromBlock(b, date, routine, s));
    if (kept) ({ carried, carriedMore } = markMissed(items, blocks, date, now, kept, taken));
  } else {
    for (const r of routine) if (r.kind !== "defrost" && r.kind !== "freeze") items.push(fromRoutine(r));
  }
  // A missed shop comes first among the earlier misses: the week's food waits on it.
  // Then a missed cook: the week's meals wait on that. Then a missed gym day, once.
  // Study shares what room is left.
  if (s) {
    const lastDay = kept?.lastDay ?? blocks?.reduce((d, b) => (b.date > d ? b.date : d), date) ?? date;
    const room = blocks ? { taken, lastDay } : null;
    const shops = missedShops(items, s, date, now, room);
    const cooks = missedCooks(items, s, date, now, room);
    const gym = missedGym(items, s, date, now);
    // Cooks, the gym and study share the few places Today keeps; the oldest study gives way.
    const life = cooks.length + gym.length;
    const cut = Math.min(carried.length, Math.max(0, life + carried.length - CARRIED_MAX));
    carriedMore += cut;
    carried = [...shops, ...cooks, ...gym, ...carried.slice(cut)];
  }
  // Life's reminders are not on the Schedule: they take no time.
  for (const r of routine) if (r.kind === "defrost" || r.kind === "freeze") items.push(fromRoutine(r));
  if (s?.setUp && !v?.plan) {
    items.push({
      key: "plan",
      start: -1,
      end: -1,
      kind: "shop",
      title: "Plan this week's meals",
      detail: "One tap picks the recipes and builds the shopping list",
      done: false,
      skipped: false,
      href: "/life",
    });
  }
  // On the day next week planned itself (this week's last cook was logged), Today says so.
  if (s && date === s.today && date < s.next.start && s.next.plan?.auto && s.next.plan.createdOn === date) {
    items.push({
      key: "next-week",
      start: -1,
      end: -1,
      kind: "shop",
      title: "Next week is planned",
      detail: "It planned itself after this week's last cook",
      done: false,
      skipped: false,
      href: "/life?week=next",
    });
  }
  items.sort((a, b) => a.start - b.start || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  // The untimed "plan the week" nudge is never next; a shop at a time is.
  const next = items.find(
    (i) => !(i.kind === "shop" && i.start < 0) && !i.done && !i.skipped && Math.max(i.end, i.start + 1) > now,
  );
  const meals = routine.filter((i) => i.kind === "meal" && i.placement);
  // What was logged for the meals logged, so a plan changed since doesn't recount them.
  const macros = (i: RoutineItem) => (i.macros !== undefined ? i.macros : placedMacros(i.placement!));
  const kcal = meals.reduce((t, i) => t + (macros(i)?.kcal ?? 0), 0);
  const protein = meals.reduce((t, i) => t + (macros(i)?.protein ?? 0), 0);
  const study = items.filter((i) => i.kind === "study").reduce((t, i) => t + (i.end - i.start), 0);
  const parts = [
    meals.length && s
      ? `${kcal.toLocaleString("en-GB")} of ${s.kcal.toLocaleString("en-GB")} kcal · ${protein} g protein`
      : "",
    study ? `${Math.round((study / 60) * 10) / 10} h study` : "",
  ].filter(Boolean);
  return {
    items,
    nextKey: next?.key ?? null,
    summary: parts.length ? parts.join(" · ") : null,
    planStart: v?.plan?.start ?? null,
    carried,
    carriedMore,
  };
}

/**
 * The study blocks that were missed, by id, as of `now` on `today`.
 *
 * Missed: the block has ended, its task is not done, and no session was logged for
 * that task on the block's day from its start on. (A session logged before the
 * block began was other work.) The Schedule marks them, and Today offers each a
 * new time.
 */
export function missedBlocks(blocks: Block[], today: string, now: number, logs: SessionLog[]): Set<string> {
  const missed = new Set<string>();
  for (const b of blocks) {
    if (b.source !== "asana" && b.source !== "session") continue;
    const over = b.date < today || (b.date === today && b.end <= now);
    if (!over || b.completed) continue;
    const task = b.taskGid ?? b.id.split(":")[0];
    if (logs.some((l) => l.taskGid === task && l.date === b.date && l.minutes >= b.start)) continue;
    missed.add(b.id);
  }
  return missed;
}

/**
 * Marks today's missed study blocks, and offers each the next free time: the first
 * gap of the block's own length from now, around everything on the Schedule, or
 * tomorrow morning when today is full and tomorrow's blocks are known. Two missed
 * blocks are never offered the same time.
 *
 * Then the misses from earlier days this week that are still owed (`carried`), after
 * today's, from the same free times: one per task, its latest; none for a task with a
 * block today or still to come, or with a session logged since; the latest few.
 */
function markMissed(
  items: DayItem[],
  blocks: Block[],
  date: string,
  now: number,
  kept: Kept,
  taken: Taken[],
): { carried: DayItem[]; carriedMore: number } {
  const missed = missedBlocks(blocks, date, now, kept.logs);
  const offer = (b: Block): Move | undefined => {
    if (!b.editable) return undefined;
    const duration = b.end - b.start;
    const tomorrow = addDays(date, 1);
    const free = nextFreeSlot(taken, date, now, duration, tomorrow <= kept.lastDay ? tomorrow : null);
    if (!free) return undefined;
    taken.push({ date: free.date, start: free.start, end: free.start + duration });
    return {
      source: b.source as Move["source"],
      id: b.id.split(":")[0],
      date: free.date,
      start: free.start,
      duration,
      label: free.date === date ? `Move to ${clock(free.start)}` : `Tomorrow ${clock(free.start)}`,
    };
  };
  const byTime = (a: Block, b: Block) => a.date.localeCompare(b.date) || a.start - b.start;

  for (const b of blocks.filter((x) => x.date === date && missed.has(x.id)).sort(byTime)) {
    const item = items.find((i) => i.key === b.id);
    if (!item) continue;
    item.missed = true;
    item.move = offer(b);
  }

  const task = (b: Block) => b.taskGid ?? b.id.split(":")[0];
  const study = blocks.filter((b) => b.source === "asana" || b.source === "session");
  // A task with a block today or later is already on Today or re-planned.
  const planned = new Set(study.filter((b) => b.date >= date).map(task));
  const latest = new Map<string, Block>();
  for (const b of study.filter((x) => x.date < date && missed.has(x.id)).sort(byTime)) latest.set(task(b), b);
  const owed = [...latest.values()]
    .filter((b) => !planned.has(task(b)))
    // Studied on a later day: caught up.
    .filter((b) => !kept.logs.some((l) => l.taskGid === task(b) && l.date > b.date))
    .sort(byTime);
  const shown = owed.slice(-CARRIED_MAX);
  const carried = shown.map((b) => {
    const item = fromBlock(b, b.date, [], null);
    return {
      ...item,
      // Its day stands where the time would: the detail keeps the time it had.
      detail: [b.project, `${clock(b.start)} to ${clock(Math.min(b.end, 24 * 60 - 1))}`].filter(Boolean).join(" · "),
      missed: true,
      move: offer(b),
      date: b.date,
    };
  });
  return { carried, carriedMore: owed.length - shown.length };
}

/** Room for Life's offers: the Schedule's time so far, and the last day whose blocks are known. */
type Room = { taken: Taken[]; lastDay: string };

/**
 * The next free time for a shop or a cook of `duration` minutes, by the rules their
 * moves keep: starting from 06:00 and no later than 22:00, today from now, or tomorrow
 * from the morning while tomorrow is in its meal week (ending `last`) and its blocks
 * are known. The time is taken, so no two offers share it.
 */
function lifeSlot(room: Room, date: string, now: number, duration: number, last: string) {
  const tomorrow = addDays(date, 1);
  const fits = (free: { date: string; start: number } | null) => (free && free.start <= LATEST ? free : null);
  const free =
    fits(nextFreeSlot(room.taken, date, Math.max(now, EARLIEST), duration)) ??
    (tomorrow <= last && tomorrow <= room.lastDay ? fits(nextFreeSlot(room.taken, tomorrow, MORNING, duration)) : null);
  if (!free) return null;
  room.taken.push({ date: free.date, start: free.start, end: free.start + duration });
  return { ...free, label: free.date === date ? `Move to ${clock(free.start)}` : `Tomorrow ${clock(free.start)}` };
}

/** This meal week's open shops that have gone by without being done, with something still to buy. */
function owedShops(s: LifeState, v: ReturnType<typeof viewOn>, date: string, now: number) {
  const lists = v.plan ? tripLists(s, v).open : [];
  const gone = (t: Trip) => !t.ticked?.length && (t.date < date || (t.date === date && t.start + SHOP_MINUTES <= now));
  return { lists, owed: lists.filter((x) => gone(x.trip) && x.lines.some((l) => l.packs > 0)) };
}

/**
 * A fresh week's shop that has gone by without being done is missed: today's is
 * marked where it stands, and one from an earlier day of this meal week is carried
 * to Today. Each is offered the next free half hour, from now until 22:00, or
 * tomorrow from the morning while tomorrow is in its meal week and its blocks are
 * known (`room`; without the Schedule there is no offer). Moving it moves the week
 * with it (life/shop-move.ts). A shop with nothing left to buy is not on Today, and
 * one being ticked off is under way, not missed.
 */
function missedShops(items: DayItem[], s: LifeState, date: string, now: number, room: Room | null): DayItem[] {
  const v = viewOn(s, date);
  const { lists, owed } = owedShops(s, v, date, now);
  if (!owed.length) return [];
  const last = addDays(v.start, 6);
  const offer = (t: Trip): Move | undefined => {
    const free = room && lifeSlot(room, date, now, SHOP_MINUTES, last);
    if (!free) return undefined;
    return { source: "shop", id: t.id, week: v.start, duration: SHOP_MINUTES, ...free };
  };

  for (const item of items) {
    const x = item.kind === "shop" && item.tripId ? owed.find((o) => o.trip.id === item.tripId) : undefined;
    if (!x || x.trip.date !== date) continue;
    item.missed = true;
    item.move = offer(x.trip);
  }
  return owed
    .filter((x) => x.trip.date < date)
    .map((x): DayItem => {
      const shown = shopsOn(s, v, x.trip.date, () => lists).find((o) => o.trip.id === x.trip.id);
      return {
        key: `shop-${x.trip.id}`,
        start: x.trip.start,
        end: x.trip.start + SHOP_MINUTES,
        kind: "shop",
        title: "Shop",
        // Its day stands where the time would: the detail keeps the time it had.
        detail: [clock(x.trip.start), shown?.list].filter(Boolean).join(" · "),
        done: false,
        skipped: false,
        href: shown?.href ?? "/life/kitchen",
        missed: true,
        move: offer(x.trip),
        date: x.trip.date,
        tripId: x.trip.id,
      };
    });
}

/**
 * A cook session whose time has gone (its start plus its longest recipe) with dishes
 * still not logged is missed: today's is marked where it stands, and one from an
 * earlier day of this meal week is carried to Today. Each is offered the next free
 * time of its own length, by the limits `moveCookSession` keeps. No offer while one
 * of the week's shops is missed: that shop's move carries the cooks that need its food.
 */
function missedCooks(items: DayItem[], s: LifeState, date: string, now: number, room: Room | null): DayItem[] {
  const v = viewOn(s, date);
  if (!v.plan) return [];
  const cooked = cookedIds(s, v.start);
  const sessions = new Map<string, { date: string; start: number; cooks: Cook[] }>();
  for (const c of v.plan.cooks) {
    const key = `${c.date}:cook:${c.start}`;
    const one = sessions.get(key) ?? { date: c.date, start: c.start, cooks: [] };
    one.cooks.push(c);
    sessions.set(key, one);
  }
  const length = (cooks: Cook[]) => Math.max(0, ...cooks.map((c) => recipe(c.recipe)?.totalMin ?? 0));
  const missed = [...sessions.values()]
    .filter((x) => x.date >= v.start && x.cooks.some((c) => !cooked.has(c.id)))
    .filter((x) => x.date < date || (x.date === date && x.start + length(x.cooks) <= now))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  if (!missed.length) return [];
  const waiting = owedShops(s, v, date, now).owed.length > 0;
  const last = addDays(v.start, 6);
  const offer = (x: { date: string; start: number; cooks: Cook[] }): Move | undefined => {
    const duration = Math.max(length(x.cooks), 15);
    const free = !waiting && room ? lifeSlot(room, date, now, duration, last) : null;
    if (!free) return undefined;
    return {
      source: "cook",
      id: `${x.date}:cook:${x.start}`,
      week: v.start,
      from: { date: x.date, at: x.start },
      duration,
      ...free,
    };
  };

  for (const x of missed.filter((m) => m.date === date)) {
    const item = items.find((i) => i.key === `plan-${x.date}:cook:${x.start}`);
    if (!item) continue;
    item.missed = true;
    item.move = offer(x);
  }
  return missed
    .filter((x) => x.date < date)
    .map((x): DayItem => {
      const left = x.cooks.filter((c) => !cooked.has(c.id));
      const names = left.map((c) => recipe(c.recipe)?.name ?? c.recipe);
      return {
        key: `cook-${x.date}-${x.start}`,
        start: x.start,
        end: x.start + length(x.cooks),
        kind: "cook",
        title: "Cook",
        // Its day stands where the time would: the detail keeps the time it had.
        detail: [clock(x.start), names.join(", ")].filter(Boolean).join(" · "),
        done: false,
        skipped: false,
        href: `/life/cook?day=${x.date}&at=${x.start}`,
        missed: true,
        move: offer(x),
        date: x.date,
      };
    });
}

/**
 * The gym, missed: on a gym day, once its time has ended with no session started that
 * day, it reads Missed where it stands. On a rest day with no session yet, the latest
 * gym day earlier this week (Monday to Sunday) that went untrained is carried to Today,
 * while the week is still short of the sessions its gym days so far planned. At most one,
 * and never on a gym day, so a missed session is offered once and never piles up or
 * lands beside the next one. It has no move (no gym time is saved): its link opens the
 * gym page, which gives the next workout in the order.
 */
function missedGym(items: DayItem[], s: LifeState, date: string, now: number): DayItem[] {
  const trained = (d: string) => s.sessions.some((x) => x.day === d);
  if (trained(date)) return [];
  const days = s.profile.gym.days;
  if (days.includes(weekdayIndex(date))) {
    for (const item of items) if (item.kind === "gym" && !item.done && item.end <= now) item.missed = true;
    return [];
  }
  const monday = addDays(date, -weekdayIndex(date));
  const earlier: string[] = [];
  for (let d = monday; d < date; d = addDays(d, 1)) if (days.includes(weekdayIndex(d))) earlier.push(d);
  const untrained = earlier.filter((d) => !trained(d));
  // Sessions this week so far, on any day: one on a rest day made a missed day up.
  const done = consistency(s.sessions, days, monday).done;
  if (!untrained.length || done >= earlier.length) return [];
  const day = untrained[untrained.length - 1];
  const key = nextWorkout(s.sessions.filter((x) => x.day < date));
  const w = workout(key);
  const minutes = w ? gymPlan(w, s.profile.gym.minutes, s.profile.gym.missing).minutes : s.profile.gym.minutes;
  const start = s.profile.gym.start;
  return [
    {
      key: `gym-${day}`,
      start,
      end: start + s.profile.gym.minutes,
      kind: "gym",
      title: `Gym: ${w ? `${w.key}, ${w.name}` : key}`,
      // Its day stands where the time would: the detail keeps the time it had.
      detail: `${clock(start)} · ${minutes} minutes`,
      done: false,
      skipped: false,
      href: "/life/gym",
      missed: true,
      date: day,
    },
  ];
}

function fromRoutine(r: RoutineItem): DayItem {
  const kind = r.kind;
  return {
    key: r.key,
    start: r.time,
    end: r.time + (kind === "gym" ? 60 : kind === "meal" ? 30 : kind === "cook" ? 60 : kind === "shop" ? 30 : 0),
    kind,
    title: r.title,
    detail: r.detail,
    done: r.done,
    skipped: Boolean(r.skipped),
    href: r.href,
    slot: kind === "meal" && r.placement?.recipe ? r.slot : undefined,
    cookIds: kind === "cook" && r.cookId && !r.done ? [r.cookId] : undefined,
    tripId: kind === "shop" && r.key.startsWith("shop-") ? r.key.slice("shop-".length) : undefined,
  };
}

function fromBlock(b: Block, date: string, routine: RoutineItem[], s: LifeState | null): DayItem {
  const base = {
    key: b.id,
    start: b.start,
    end: b.end,
    title: b.title,
    done: false,
    skipped: false,
    href: b.url,
    note: b.note,
    clash: b.clash,
  };
  const until = `until ${clock(Math.min(b.end, 24 * 60 - 1))}`;
  if (b.source === "asana" || b.source === "session") {
    return {
      ...base,
      kind: "study",
      detail: [b.project, until].filter(Boolean).join(" · "),
      done: Boolean(b.completed),
      taskGid: b.taskGid ?? b.id.split(":")[0],
    };
  }
  if (b.source === "google") {
    const life = b.kind ? LIFE_KINDS[b.kind as LifeKind] : undefined;
    return {
      ...base,
      kind: life ? "life" : "event",
      detail: `${life?.label ?? "Calendar"} · ${until}`,
      external: true,
    };
  }
  // The Life plan: its key says what it is ("2026-11-12:meal:lunch").
  const [, type, rest] = b.id.slice("plan-".length).split(":");
  if (type === "meal") {
    const r = routine.find((x) => x.kind === "meal" && x.slot === rest);
    return r
      ? {
          ...base,
          kind: "meal",
          title: r.title,
          detail: r.detail,
          done: r.done,
          skipped: Boolean(r.skipped),
          href: r.href,
          slot: r.placement?.recipe ? r.slot : undefined,
        }
      : { ...base, kind: "meal", detail: "" };
  }
  if (type === "gym" || type === "weigh") {
    const r = routine.find((x) => x.kind === type);
    return { ...base, kind: type, detail: r?.detail ?? "", done: Boolean(r?.done), href: r?.href ?? b.url };
  }
  if (type === "shop") {
    const r = routine.find((x) => x.kind === "shop" && x.time === Number(rest));
    const trip = s ? freshTrips(viewOn(s, date)).find((t) => t.date === date && t.start === Number(rest)) : undefined;
    return {
      ...base,
      kind: "shop",
      title: "Shop",
      detail: r?.detail ?? b.title.replace(/^Shop: /, ""),
      done: Boolean(r?.done),
      href: r?.href ?? b.url,
      tripId: trip?.id,
    };
  }
  if (type === "cook" && s) {
    const v = viewOn(s, date);
    const cooks = v.plan?.cooks.filter((c) => c.date === date && c.start === Number(rest)) ?? [];
    const cooked = cookedIds(s, v.start);
    const left = cooks.filter((c) => !cooked.has(c.id));
    const minutes = Math.max(0, ...cooks.map((c) => recipe(c.recipe)?.totalMin ?? 0));
    const detail =
      left.length === 0
        ? "Cooked"
        : left.length < cooks.length
          ? `${cooks.length - left.length} of ${cooks.length} cooked`
          : cooks.length === 1
            ? `${cooks[0].portions} portions · ${minutes} min`
            : `${cooks.length} recipes · about ${minutes} min`;
    return {
      ...base,
      kind: "cook",
      detail,
      done: cooks.length > 0 && left.length === 0,
      cookIds: left.map((c) => c.id),
      // The session's Cook view: get ready, each dish, box up.
      href: cooks.length ? `/life/cook?day=${date}&at=${cooks[0].start}` : base.href,
    };
  }
  return { ...base, kind: "life", detail: until };
}
