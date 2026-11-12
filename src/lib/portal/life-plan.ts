// The Life plan on the Schedule: the plan's items for a week, arranged around
// everything else on it. Pure, so it is tested.

import { arrange, lifeAgenda, type AgendaItem, type Busy } from "../life/agenda.ts";
import type { LifeState } from "../life/state.ts";
import type { Block } from "./schedule.ts";

/** Life block kinds that stand for a plan item of the same kind. */
const FAMILY: Record<string, AgendaItem["colour"]> = { lunch: "lunch", cooking: "cooking", gym: "gym" };
const firstWord = (t: string) => t.trim().split(/[\s:,]+/)[0]?.toLowerCase() ?? "";

/**
 * The Life plan's items for these days, arranged around the rest of the week.
 * A life block you added yourself for the same thing at the same time (a Gym
 * block over the planned gym) stands in for the plan's item, so it shows once.
 * Only from this meal week on: earlier weeks' plans are not kept in view.
 */
export function lifeBlocks(s: LifeState, days: string[], others: Block[], now?: { date: string; minutes: number }): { blocks: Block[]; items: AgendaItem[] } {
  const shown = days.filter((d) => d >= s.weekStart);
  if (!shown.length || !s.setUp) return { blocks: [], items: [] };
  const own = others.filter((b) => b.source === "google" && b.kind);
  const standIn = (i: AgendaItem) =>
    own.some(
      (b) =>
        b.date === i.date &&
        b.start < i.preferred + i.duration &&
        i.preferred < b.end &&
        (FAMILY[b.kind!] === i.colour || firstWord(b.title) === firstWord(i.title)),
    );
  const wanted = lifeAgenda(s, shown).filter((i) => !standIn(i));
  // Everything that is not part of the plan holds its time. Invites still unanswered are already left out.
  const busy: Busy[] = others.map((b) => ({ date: b.date, start: b.start, end: b.end, title: b.title }));
  const items = arrange(wanted, busy, 15, now);
  const blocks = items.map(
    (i): Block => ({
      id: `plan-${i.key}`,
      source: "plan",
      title: i.title,
      date: i.date,
      start: i.start,
      end: Math.min(24 * 60, i.start + i.duration),
      url: i.href,
      editable: false,
      kind: i.colour,
      note: i.moved ?? i.clash,
      clash: Boolean(i.clash),
    }),
  );
  return { blocks, items };
}
