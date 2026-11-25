// How the search went week by week: applications sent, and how many were close fits.
//
// A steady, well-aimed search predicts a good job; sheer volume does not (van Hooft
// et al., Journal of Applied Psychology, 2021). Recording progress, and reporting it
// to someone such as a mentor, helps people reach a goal (Harkin et al., Psychological
// Bulletin, 2016). So this is a record, never a quota: no target and no streak.
// Pure, so it is tested.

import { addDays, weekdayIndex } from "../dates/week.ts";
import type { Band } from "./match.ts";

type Sent = { applied_on: string | null; stage: string; fit: { band: Band } };

export type RhythmWeek = {
  /** Monday, YYYY-MM-DD. */
  start: string;
  sent: number;
  /** Of those, how many are Ready or On your plan today. */
  close: number;
};

export type Rhythm = {
  /** Oldest first; the last is the week containing today. */
  weeks: RhythmWeek[];
  sent: number;
  close: number;
  /** Of those sent, how many are at interview or offer now. */
  interviews: number;
};

const CLOSE = new Set<Band>(["ready", "by_date"]);

/**
 * The last `weeks` Monday-to-Sunday weeks, ending with this one. A role counts in the
 * week it was sent, whatever its stage now: an application sent stays sent.
 */
export function searchRhythm(roles: Sent[], today: string, weeks = 8): Rhythm {
  const thisWeek = addDays(today, -weekdayIndex(today));
  const rows: RhythmWeek[] = Array.from({ length: weeks }, (_, i) => ({
    start: addDays(thisWeek, (i - weeks + 1) * 7),
    sent: 0,
    close: 0,
  }));
  const from = rows[0]?.start ?? thisWeek;
  const until = addDays(thisWeek, 7);
  let interviews = 0;
  for (const role of roles) {
    const on = role.applied_on?.slice(0, 10);
    if (!on || on < from || on >= until) continue;
    const week = rows.find((w) => on >= w.start && on < addDays(w.start, 7));
    if (!week) continue;
    week.sent += 1;
    if (CLOSE.has(role.fit.band)) week.close += 1;
    if (role.stage === "interview" || role.stage === "offer") interviews += 1;
  }
  return {
    weeks: rows,
    sent: rows.reduce((n, w) => n + w.sent, 0),
    close: rows.reduce((n, w) => n + w.close, 0),
    interviews,
  };
}

/** Applications sent in the week containing today. */
export const sentThisWeek = (rhythm: Rhythm): number => rhythm.weeks.at(-1)?.sent ?? 0;

/** "9 sent in 8 weeks, 6 of them close fits, 2 now at interview or offer." */
export function rhythmLine(rhythm: Rhythm): string {
  const span = `${rhythm.weeks.length} ${rhythm.weeks.length === 1 ? "week" : "weeks"}`;
  if (rhythm.sent === 0) return `None sent in the last ${span}.`;
  const close = rhythm.close === 1 ? "1 of them a close fit" : `${rhythm.close} of them close fits`;
  return `${rhythm.sent} sent in ${span}, ${close}, ${rhythm.interviews} now at interview or offer.`;
}
