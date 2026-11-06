// How many hours of study fall on which day. Kept apart from the plans so the pace
// form can use it in the browser without carrying the plans along.

import { addDays } from "../dates/week.ts";

export type Pace = {
  hoursPerWeek: number;
  /** From this day the pace changes, for a job starting or a holiday ending. */
  until?: string;
  thenHoursPerWeek?: number;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** The day a given number of hours of study is reached, counting from start. */
export function dayAfterHours(start: string, hours: number, pace: Pace): string {
  const first = Math.max(pace.hoursPerWeek, 0.1);
  const onFirstPace = (h: number) => addDays(start, Math.max(Math.ceil((h * 7) / first) - 1, 0));
  if (!pace.until || !pace.thenHoursPerWeek || pace.until <= start) return onFirstPace(hours);
  const available = (daysBetween(start, pace.until) * first) / 7;
  if (hours <= available) return onFirstPace(hours);
  return addDays(pace.until, Math.max(Math.ceil(((hours - available) * 7) / Math.max(pace.thenHoursPerWeek, 0.1)) - 1, 0));
}

/** Whole weeks a number of hours takes, for the sentence under the form. */
export function weeksFor(start: string, hours: number, pace: Pace): number {
  return Math.max(Math.ceil((daysBetween(start, dayAfterHours(start, hours, pace)) + 1) / 7), 1);
}
