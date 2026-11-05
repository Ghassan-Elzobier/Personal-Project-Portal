// Totals for the dashboards, from session comments. Pure, so it is tested with
// node's test runner. Days studied is a plain count: a missed day never resets
// anything, because the point is to come back tomorrow.

import { addDays, dateIn, weekOf, type Week } from "../dates/week.ts";
import { sessionHours } from "../tasks/session-log.ts";

type Comment = { text: string; createdAt: string };

const round = (n: number) => Math.round(n * 100) / 100;

export type StudyTotals = { today: number; week: number; daysStudied: number };

export function studyTotals(comments: Comment[], week: Week, today: string, tz: string): StudyTotals {
  const byDay = new Map<string, number>();
  for (const c of comments) {
    const hours = sessionHours(c.text);
    if (!hours) continue;
    const day = dateIn(new Date(c.createdAt), tz);
    if (day >= week.start && day <= week.end) byDay.set(day, (byDay.get(day) ?? 0) + hours);
  }
  return {
    today: round(byDay.get(today) ?? 0),
    week: round([...byDay.values()].reduce((a, b) => a + b, 0)),
    daysStudied: byDay.size,
  };
}

export type WeekHours = { start: string; hours: number };

/** Hours per week, oldest first, ending with the week containing now. */
export function hoursByWeek(comments: Comment[], weeks: number, now: Date, tz: string): WeekHours[] {
  const current = weekOf(now, tz).start;
  const buckets: WeekHours[] = Array.from({ length: weeks }, (_, i) => ({ start: addDays(current, (i - weeks + 1) * 7), hours: 0 }));
  for (const c of comments) {
    const hours = sessionHours(c.text);
    if (!hours) continue;
    const day = dateIn(new Date(c.createdAt), tz);
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (day >= buckets[i].start) {
        if (day < addDays(buckets[i].start, 7)) buckets[i].hours = round(buckets[i].hours + hours);
        break;
      }
    }
  }
  return buckets;
}

/** Timer time as loggable hours: to the nearest quarter, at least 0.25, at most 16. */
export function timerHours(ms: number): number {
  const quarters = Math.round(ms / (15 * 60 * 1000));
  return Math.min(16, Math.max(0.25, quarters / 4));
}

export function timerClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
