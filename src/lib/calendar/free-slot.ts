// Where a block of time could go next.
//
// The Life plan already moves a meal or a cook that clashes to the nearest free
// time (life/agenda.ts). A study block that was missed had no such help: the plan
// just broke, and re-planning meant finding a gap by eye on a narrow grid. This
// finds the next free time, so Today can offer it in one tap. A plan that says
// when to act is what gets acted on (Gollwitzer and Sheeran, 2006), and one missed
// day costs little if the block is put back before misses pile up (Lally et al.,
// 2010). Pure, so it is tested.

/** Whether two stretches of time, each from its start up to its end, share any of it. */
export const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** Time already spoken for, in minutes after midnight on its day. */
export type Taken = { date: string; start: number; end: number };

/** Times are offered on the quarter hour, as the Schedule's grid snaps them. */
const STEP = 15;
/** Where the Schedule starts a new block by default: tomorrow is offered from here, not from dawn. */
export const MORNING = 9 * 60;
/** A block never runs past the end of its day. */
const DAY_END = 24 * 60;

function firstGap(taken: Taken[], date: string, from: number, duration: number): number | null {
  const busy = taken.filter((t) => t.date === date);
  for (let start = Math.ceil(from / STEP) * STEP; start + duration <= DAY_END; start += STEP)
    if (!busy.some((t) => overlaps(start, start + duration, t.start, t.end))) return start;
  return null;
}

/**
 * The next free time for a block of `duration` minutes: today from `now`, rounded
 * up to the quarter hour, and when today has no room, `tomorrow` from the morning.
 * It overlaps nothing in `taken` and keeps the block's whole length inside the day.
 * Pass no `tomorrow` when its blocks are not known. Null when there is no room.
 */
export function nextFreeSlot(
  taken: Taken[],
  today: string,
  now: number,
  duration: number,
  tomorrow: string | null = null,
): { date: string; start: number } | null {
  if (duration <= 0) return null;
  const sameDay = firstGap(taken, today, now, duration);
  if (sameDay !== null) return { date: today, start: sameDay };
  const nextDay = tomorrow === null ? null : firstGap(taken, tomorrow, MORNING, duration);
  return nextDay === null ? null : { date: tomorrow!, start: nextDay };
}
