// The week's study plan set against its target, for the Schedule: hours logged,
// hours still planned in study blocks, hours missed, and what is short or over.
// Pure, so it is tested.

import type { SessionLog } from "./day.ts";
import type { Block } from "./schedule.ts";

export type StudyWeek = {
  /** Hours logged in sessions this week, as Today counts them. */
  logged: number;
  /** Hours in study blocks still to come: not done, not ended, not already logged. */
  toCome: number;
  /** Hours in study blocks that passed with nothing logged. */
  missed: number;
  target: number | null;
  /** Hours the target needs that no block holds. Null with no target. */
  short: number | null;
  /** Hours planned past the target. Null with no target. */
  over: number | null;
};

const round = (n: number) => Math.round(n * 100) / 100;
const hours = (b: Block) => (b.end - b.start) / 60;

export function studyWeek(input: {
  blocks: Block[];
  /** The ids missedBlocks() returns. */
  missed: ReadonlySet<string>;
  logs: SessionLog[];
  logged: number;
  target: number | null;
  today: string;
  /** Minutes after midnight, now. */
  now: number;
}): StudyWeek {
  const { blocks, missed, logs, logged, target, today, now } = input;
  let toCome = 0;
  let missedHours = 0;
  for (const b of blocks) {
    if (b.source !== "asana" && b.source !== "session") continue;
    if (missed.has(b.id)) {
      missedHours += hours(b);
      continue;
    }
    if (b.completed) continue;
    const ended = b.date < today || (b.date === today && b.end <= now);
    if (ended) continue;
    // A block under way with a session logged since it began is in the logged hours already.
    const running = b.date === today && b.start <= now;
    const task = b.taskGid ?? b.id.split(":")[0];
    if (running && logs.some((l) => l.taskGid === task && l.date === b.date && l.minutes >= b.start)) continue;
    toCome += hours(b);
  }
  const total = logged + toCome;
  return {
    logged: round(logged),
    toCome: round(toCome),
    missed: round(missedHours),
    target,
    short: target === null ? null : round(Math.max(0, target - total)),
    over: target === null ? null : round(Math.max(0, total - target)),
  };
}
