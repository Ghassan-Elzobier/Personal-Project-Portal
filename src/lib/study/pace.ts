// How many hours of study fall on which day. Kept apart from the plans so the pace
// form can use it in the browser without carrying the plans along.

import { addDays } from "../dates/week.ts";

export type Pace = {
  hoursPerWeek: number;
  /** From this day the pace changes, for a job starting or a holiday ending. */
  until?: string;
  thenHoursPerWeek?: number;
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** The day a given number of hours of study is reached, counting from start. */
export function dayAfterHours(start: string, hours: number, pace: Pace): string {
  const first = Math.max(pace.hoursPerWeek, 0.1);
  const onFirstPace = (h: number) => addDays(start, Math.max(Math.ceil((h * 7) / first) - 1, 0));
  if (!pace.until || !pace.thenHoursPerWeek || pace.until <= start) return onFirstPace(hours);
  const available = (daysBetween(start, pace.until) * first) / 7;
  if (hours <= available) return onFirstPace(hours);
  return addDays(
    pace.until,
    Math.max(Math.ceil(((hours - available) * 7) / Math.max(pace.thenHoursPerWeek, 0.1)) - 1, 0),
  );
}

/** Whole weeks a number of hours takes, for the sentence under the form. */
export function weeksFor(start: string, hours: number, pace: Pace): number {
  return Math.max(Math.ceil((daysBetween(start, dayAfterHours(start, hours, pace)) + 1) / 7), 1);
}

/** A pace as the owner set it on the Study page: the hours, and the day they start. */
export type SavedPace = Pace & { start: string };

/**
 * The pace to save for what the pace form sent. A change that does not come after
 * the start is left out, as dayAfterHours leaves it out of the dates.
 */
export function savedAs(hoursPerWeek: number, start: string, then?: { from: string; hoursPerWeek: number }): SavedPace {
  return then && then.from > start
    ? { start, hoursPerWeek, until: then.from, thenHoursPerWeek: then.hoursPerWeek }
    : { start, hoursPerWeek };
}

/**
 * The hours of study a week is counted against, given its Monday. A change of pace
 * counts for the whole week it falls in, so the target moves once, as that week
 * starts, and never part-way through one.
 */
export function weekTarget(pace: Pace, weekStart: string): number {
  if (pace.until && pace.thenHoursPerWeek && pace.until <= addDays(weekStart, 6)) return pace.thenHoursPerWeek;
  return pace.hoursPerWeek;
}

/**
 * The pace as it stands on a day, for the pace form to open on. Once the change
 * has come, the later hours are the pace and there is no change left to show.
 */
export function paceOn(pace: Pace, day: string): Pace {
  if (!pace.until || !pace.thenHoursPerWeek) return { hoursPerWeek: pace.hoursPerWeek };
  if (pace.until <= day) return { hoursPerWeek: pace.thenHoursPerWeek };
  return { hoursPerWeek: pace.hoursPerWeek, until: pace.until, thenHoursPerWeek: pace.thenHoursPerWeek };
}
