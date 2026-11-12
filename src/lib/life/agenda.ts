// The Life side of the schedule, built from the plans themselves: each meal with
// its recipe from the meal plan, the cook sessions with what they cook, the gym
// session the rotation says is next, and the morning weigh-in. Then arranged
// around everything fixed (study, work meetings, other events): a life item that
// clashes moves to the nearest free time inside its own window, so lunch stays a
// lunch and the shake stays after the gym. Fixed things never move. Pure, so it
// is tested.

import { addDays, weekdayIndex } from "../dates/week.ts";
import { workout } from "./gym/program.ts";
import { nextWorkout } from "./gym/progress.ts";
import type { Slot } from "./nutrition.ts";
import { slotTime } from "./planner.ts";
import { plannerRoutine } from "./profile.ts";
import { recipe } from "./recipes.ts";
import { viewOn, type LifeState } from "./state.ts";

/** Calendar colour family, matching the life block kinds. */
export type AgendaColour = "lunch" | "cooking" | "gym" | "other";

export type AgendaItem = {
  /** Stable for the same thing on the same day, so a calendar copy can be updated in place. */
  key: string;
  date: string;
  kind: "weigh" | "meal" | "gym" | "cook";
  colour: AgendaColour;
  slot?: Slot;
  title: string;
  /** Where it ended up, in minutes after midnight. */
  start: number;
  duration: number;
  /** Where the plan put it. */
  preferred: number;
  /** Earliest start and latest end it may move within. */
  window: [number, number];
  /** Placed first when lower. */
  priority: number;
  /** Ties go later for these (dinner after a cook, shake after training). */
  preferLater?: boolean;
  /** Why it moved, or why it could not. */
  moved?: string;
  clash?: string;
  href: string;
};

export type Busy = { date: string; start: number; end: number; title: string };

const SLOT_NAME: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", shake: "Shake", dinner: "Dinner" };

const clampWindow = (a: number, b: number): [number, number] => [Math.max(0, a), Math.min(24 * 60, b)];

/** The life items each day holds, where the plans put them. */
export function lifeAgenda(s: LifeState, days: string[]): AgendaItem[] {
  const routine = plannerRoutine(s.profile);
  const gymDays = s.profile.gym.days;
  const gymStart = s.profile.gym.start;
  const gymEnd = gymStart + s.profile.gym.minutes;
  const items: AgendaItem[] = [];

  const sorted = [...days].sort();
  const workoutOn = rotation(s, sorted[sorted.length - 1] ?? s.today);

  for (const date of sorted) {
    const gymDay = gymDays.includes(weekdayIndex(date));
    const v = viewOn(s, date);

    items.push({
      key: `${date}:weigh`,
      date,
      kind: "weigh",
      colour: "other",
      title: "Weigh in",
      start: routine.breakfast - 15,
      preferred: routine.breakfast - 15,
      duration: 15,
      window: clampWindow(5 * 60, 10 * 60),
      priority: 7,
      href: "/life/body",
    });

    if (gymDay) {
      const key = workoutOn(date);
      const w = workout(key);
      items.push({
        key: `${date}:gym`,
        date,
        kind: "gym",
        colour: "gym",
        title: `Gym: ${w ? `${w.key}, ${w.name}` : key}`,
        start: gymStart,
        preferred: gymStart,
        duration: s.profile.gym.minutes,
        window: clampWindow(gymStart - 60, gymEnd + 90),
        priority: 1,
        href: "/life/gym",
      });
    }

    // Cook sessions: one item per session, as long as its longest recipe plus clearing up.
    const sessions = new Map<number, string[]>();
    const longest = new Map<number, number>();
    for (const c of v.plan?.cooks.filter((x) => x.date === date) ?? []) {
      const r = recipe(c.recipe);
      if (!r) continue;
      sessions.set(c.start, [...(sessions.get(c.start) ?? []), r.name]);
      longest.set(c.start, Math.max(longest.get(c.start) ?? 0, r.totalMin));
    }
    for (const [start, names] of sessions) {
      const duration = Math.ceil(((longest.get(start) ?? 60) + 20) / 15) * 15;
      items.push({
        key: `${date}:cook:${start}`,
        date,
        kind: "cook",
        colour: "cooking",
        title: `Cook: ${names.join(", ")}`,
        start,
        preferred: start,
        duration,
        window: clampWindow(9 * 60, 22 * 60),
        priority: 2,
        href: "/life/kitchen?tab=fridge",
      });
    }

    // Meals: from the plan when there is one, at the routine's times otherwise.
    const placed = v.placements.filter((p) => p.date === date);
    for (const slot of ["breakfast", "lunch", "shake", "dinner"] as Slot[]) {
      const p = placed.find((x) => x.slot === slot);
      if (p?.source === "out") continue;
      const r = p?.recipe ? recipe(p.recipe) : undefined;
      const at = p?.time ?? slotTime(routine, date, slot);
      const fresh = p?.source === "fresh" && r ? r : null;
      // A meal cooked fresh starts when the cooking does.
      const duration = fresh ? Math.max(30, Math.ceil(fresh.totalMin / 15) * 15) : slot === "shake" ? 15 : slot === "breakfast" ? 20 : 30;
      const start = fresh ? at - (duration - 30) : at;
      const window: [number, number] =
        slot === "breakfast"
          ? gymDay
            ? clampWindow(gymStart - 120, gymStart - 10)
            : clampWindow(5 * 60 + 30, 10 * 60)
          : slot === "lunch"
            ? clampWindow(11 * 60 + 30, 14 * 60 + 30)
            : slot === "dinner"
              ? clampWindow(17 * 60 + 15, 22 * 60)
              : gymDay
                ? clampWindow(gymEnd, gymEnd + 150)
                : clampWindow(at - 120, at + 150);
      items.push({
        key: `${date}:meal:${slot}`,
        date,
        kind: "meal",
        colour: "lunch",
        slot,
        title: `${SLOT_NAME[slot]}${fresh ? " (cook fresh)" : ""}${r ? `: ${r.name}` : ""}`,
        start,
        preferred: start,
        duration,
        window,
        priority: slot === "dinner" ? 3 : slot === "lunch" ? 4 : slot === "breakfast" ? 5 : 6,
        preferLater: slot === "dinner" || slot === "shake",
        href: r ? `/life/recipes/${r.key}` : "/life",
      });
    }
  }
  return items;
}

/**
 * The workout each gym day holds. A day trained shows what was done; a past day
 * missed shows what was due then; from today on the rotation carries on from the
 * last session, one step per gym day, so next week follows on from this one.
 */
function rotation(s: LifeState, last: string): (date: string) => string {
  const ahead = new Map<string, string>();
  let next = nextWorkout(s.sessions.filter((x) => x.day < s.today));
  for (let d = s.today; d <= last; d = addDays(d, 1)) {
    if (!s.profile.gym.days.includes(weekdayIndex(d))) continue;
    const key = s.sessions.find((x) => x.day === d)?.workout ?? next;
    ahead.set(d, key);
    next = nextWorkout([{ day: d, workout: key, finished: true, feel: null, notes: "" }]);
  }
  return (date) => s.sessions.find((x) => x.day === date)?.workout ?? ahead.get(date) ?? nextWorkout(s.sessions.filter((x) => x.day < date));
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/**
 * Moves clashing life items to the nearest free time in their window, most
 * important first: gym and cooking, then dinner, lunch, breakfast, the shake and
 * the weigh-in. Busy time is never moved. An item with nowhere to go stays put
 * and says what it clashes with.
 */
export function arrange(items: AgendaItem[], busy: Busy[], step = 15): AgendaItem[] {
  const out: AgendaItem[] = [];
  const byDay = new Map<string, AgendaItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  for (const [date, list] of byDay) {
    const fixed = busy.filter((b) => b.date === date);
    const placed: AgendaItem[] = [];
    const conflict = (start: number, item: AgendaItem): string | null => {
      const end = start + item.duration;
      const hit = fixed.find((b) => overlaps(start, end, b.start, b.end));
      if (hit) return hit.title;
      const mine = placed.find((p) => overlaps(start, end, p.start, p.start + p.duration));
      // Another life item by its kind alone ("Cook", "Gym"), not its whole recipe list.
      return mine ? mine.title.split(":")[0] : null;
    };
    for (const item of [...list].sort((a, b) => a.priority - b.priority || a.preferred - b.preferred)) {
      const first = conflict(item.preferred, item);
      if (!first) {
        placed.push({ ...item, start: item.preferred });
        continue;
      }
      let found: number | null = null;
      const [lo, hi] = item.window;
      for (let d = step; d <= 24 * 60 && found === null; d += step) {
        const order = item.preferLater ? [item.preferred + d, item.preferred - d] : [item.preferred - d, item.preferred + d];
        for (const t of order) {
          if (t < lo || t + item.duration > hi) continue;
          if (!conflict(t, item)) {
            found = t;
            break;
          }
        }
        if (item.preferred - d < lo && item.preferred + d + item.duration > hi) break;
      }
      placed.push(
        found === null
          ? { ...item, start: item.preferred, clash: `Clashes with ${first}` }
          : { ...item, start: found, moved: `Moved from ${clockOf(item.preferred)}: clashes with ${first}` },
      );
    }
    out.push(...placed);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

function clockOf(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
