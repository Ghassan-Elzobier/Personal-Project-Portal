// When to look at something again, and how to pace a book. Pure, so it is tested
// with node's test runner. Spacing and self-testing have the strongest evidence
// behind them, but no exact schedule does, so these gaps are a sensible default
// rather than a proven formula.

import { addDays } from "../dates/week.ts";

export type Rating = "got" | "shaky" | "missed";

const GAPS = [1, 3, 7, 14, 30, 60, 120];

/** A redone exercise is settled sooner than a theorem you want to keep for good. */
const LAST_STEP: Record<string, number> = { exercise: 3, result: GAPS.length - 1, idea: GAPS.length - 1 };

export type NextReview = { step: number; dueOn: string | null; retire: boolean };

export function nextReview(input: { step: number; kind: string; rating: Rating; today: string }): NextReview {
  const { step, kind, rating, today } = input;
  if (rating === "missed") return { step: 0, dueOn: addDays(today, GAPS[0]), retire: false };
  const current = Math.min(step, GAPS.length - 1);
  if (rating === "shaky") return { step: current, dueOn: addDays(today, GAPS[current]), retire: false };
  const next = current + 1;
  if (next > (LAST_STEP[kind] ?? GAPS.length - 1)) return { step: current, dueOn: null, retire: true };
  return { step: next, dueOn: addDays(today, GAPS[next]), retire: false };
}

/** Plain words for a gap on a rating button: "tomorrow", "in 7 days". */
export function gapLabel(today: string, dueOn: string | null): string {
  if (!dueOn) return "done with this";
  const days = Math.round((Date.parse(`${dueOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/**
 * Spreads units evenly from a start day at so many a week. A slow week simply
 * means pressing this again: nothing has to pile up as overdue.
 */
export function spreadDates<T>(units: T[], start: string, perWeek: number): { unit: T; dueOn: string }[] {
  const pace = Math.max(perWeek, 0.1);
  return units.map((unit, i) => ({ unit, dueOn: addDays(start, Math.max(Math.ceil(((i + 1) * 7) / pace) - 1, 0)) }));
}

export type ExerciseStatus = "solved" | "hint" | "stuck" | "skip";

const CYCLE: (ExerciseStatus | null)[] = [null, "solved", "hint", "stuck", "skip"];

/** Each tap moves an exercise to its next state. */
export function nextExerciseStatus(status: ExerciseStatus | null): ExerciseStatus | null {
  return CYCLE[(CYCLE.indexOf(status) + 1) % CYCLE.length];
}

export type ExerciseTally = { solved: number; hint: number; stuck: number; skip: number };

export function tallyExercises(statuses: ExerciseStatus[]): ExerciseTally {
  const tally: ExerciseTally = { solved: 0, hint: 0, stuck: 0, skip: 0 };
  for (const s of statuses) tally[s]++;
  return tally;
}
