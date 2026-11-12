// Your day on Today: the Schedule's day in order, with what each item needs from
// you. Study, events and the Life plan come from the blocks the Schedule shows,
// at the same times, so the two always agree. Life adds what only it knows:
// whether a meal is eaten, what a cook makes and whether it is done, and the
// defrost and freeze reminders. Pure, so it is tested.

import { LIFE_KINDS, type LifeKind } from "../calendar/life-blocks.ts";
import { clock } from "../dates/week.ts";
import type { Slot } from "../life/nutrition.ts";
import { recipe } from "../life/recipes.ts";
import { placedMacros, routineFor, viewOn, type LifeState, type RoutineItem } from "../life/state.ts";
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
};

export type Day = { items: DayItem[]; nextKey: string | null; summary: string | null; planStart: string | null };

const ORDER: DayItem["kind"][] = ["shop", "weigh", "meal", "gym", "study", "event", "life", "cook", "freeze", "defrost"];

/**
 * The day, from the Schedule's blocks for it and the Life state. Without blocks
 * (the Schedule could not be read) the Life items stand alone at their planned times.
 */
export function yourDay(date: string, blocks: Block[] | null, s: LifeState | null, now: number): Day {
  const routine = s ? routineFor(s, date) : [];
  const v = s ? viewOn(s, date) : null;
  const items: DayItem[] = [];

  if (blocks) {
    for (const b of blocks.filter((x) => x.date === date)) items.push(fromBlock(b, date, routine, s));
  } else {
    for (const r of routine) if (r.kind !== "defrost" && r.kind !== "freeze") items.push(fromRoutine(r));
  }
  // Life's reminders are not on the Schedule: they take no time.
  for (const r of routine) if (r.kind === "defrost" || r.kind === "freeze") items.push(fromRoutine(r));
  if (s?.setUp && !v?.plan) {
    items.push({ key: "plan", start: -1, end: -1, kind: "shop", title: "Plan this week's meals", detail: "One tap picks the recipes and builds the shopping list", done: false, skipped: false, href: "/life" });
  }
  items.sort((a, b) => a.start - b.start || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const next = items.find((i) => i.kind !== "shop" && !i.done && !i.skipped && Math.max(i.end, i.start + 1) > now);
  const meals = routine.filter((i) => i.kind === "meal" && i.placement);
  const kcal = meals.reduce((t, i) => t + (placedMacros(i.placement!)?.kcal ?? 0), 0);
  const protein = meals.reduce((t, i) => t + (placedMacros(i.placement!)?.protein ?? 0), 0);
  const study = items.filter((i) => i.kind === "study").reduce((t, i) => t + (i.end - i.start), 0);
  const parts = [
    meals.length && s ? `${kcal.toLocaleString("en-GB")} of ${s.kcal.toLocaleString("en-GB")} kcal · ${protein} g protein` : "",
    study ? `${Math.round((study / 60) * 10) / 10} h study` : "",
  ].filter(Boolean);
  return { items, nextKey: next?.key ?? null, summary: parts.length ? parts.join(" · ") : null, planStart: v?.plan?.start ?? null };
}

function fromRoutine(r: RoutineItem): DayItem {
  const kind = r.kind;
  return {
    key: r.key,
    start: r.time,
    end: r.time + (kind === "gym" ? 60 : kind === "meal" ? 30 : kind === "cook" ? 60 : 0),
    kind,
    title: r.title,
    detail: r.detail,
    done: r.done,
    skipped: Boolean(r.skipped),
    href: r.href,
    slot: kind === "meal" && r.placement?.recipe ? r.slot : undefined,
    cookIds: kind === "cook" && r.cookId && !r.done ? [r.cookId] : undefined,
  };
}

function fromBlock(b: Block, date: string, routine: RoutineItem[], s: LifeState | null): DayItem {
  const base = { key: b.id, start: b.start, end: b.end, title: b.title, done: false, skipped: false, href: b.url, note: b.note, clash: b.clash };
  const until = `until ${clock(Math.min(b.end, 24 * 60 - 1))}`;
  if (b.source === "asana" || b.source === "session") {
    return { ...base, kind: "study", detail: [b.project, until].filter(Boolean).join(" · "), done: Boolean(b.completed), taskGid: b.taskGid ?? b.id.split(":")[0] };
  }
  if (b.source === "google") {
    const life = b.kind ? LIFE_KINDS[b.kind as LifeKind] : undefined;
    return { ...base, kind: life ? "life" : "event", detail: `${life?.label ?? "Calendar"} · ${until}`, external: true };
  }
  // The Life plan: its key says what it is ("2026-11-12:meal:lunch").
  const [, type, rest] = b.id.slice("plan-".length).split(":");
  if (type === "meal") {
    const r = routine.find((x) => x.kind === "meal" && x.slot === rest);
    return r ? { ...base, kind: "meal", title: r.title, detail: r.detail, done: r.done, skipped: Boolean(r.skipped), href: r.href, slot: r.placement?.recipe ? r.slot : undefined } : { ...base, kind: "meal", detail: "" };
  }
  if (type === "gym" || type === "weigh") {
    const r = routine.find((x) => x.kind === type);
    return { ...base, kind: type, detail: r?.detail ?? "", done: Boolean(r?.done), href: r?.href ?? b.url };
  }
  if (type === "cook" && s) {
    const v = viewOn(s, date);
    const cooks = v.plan?.cooks.filter((c) => c.date === date && c.start === Number(rest)) ?? [];
    const cooked = new Set(s.batches.filter((x) => x.planStart === v.start && x.cookId).map((x) => x.cookId!));
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
    return { ...base, kind: "cook", detail, done: cooks.length > 0 && left.length === 0, cookIds: left.map((c) => c.id) };
  }
  return { ...base, kind: "life", detail: until };
}
