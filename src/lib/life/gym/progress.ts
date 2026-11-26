// What to lift next time, and how the bench is coming along.
//
// Progression is double progression: work in a rep range at a weight, and once
// every set reaches the top of the range, add the smallest step. Bodyweight moves
// like pull-ups and dips work the same way with weight added on a belt; core moves
// with nothing to add get slower and harder instead. A heavy top set
// moves up when it reaches the top of its range. Missing the bottom of the range
// twice running takes 5% off, which is the usual reset. Someone coming back from
// a break keeps an extra rep in reserve for the first two weeks, because strength
// returns quickly but tendons and soreness lag behind.
//
// On an assisted machine the help is logged as negative kg, so the same steps take
// help away (35 kg of help, then 32.5), and missing the range twice adds a step of
// help back rather than taking 5% off.
//
// The reps left in the tank that the lifter logs steer the step, as the RIR scale
// is meant to (Helms et al. 2016): when the top of the range came with less left
// than the plan asks for, the weight holds until it comes with room to spare; when
// every set had two or more extra, the step doubles. A set logged without it
// changes nothing, and neither does one logged as planned.
//
// Estimated one-rep max uses Epley's formula with reps in reserve added to the
// reps done, so a set of 5 with 2 left counts like a 7-rep max. It is only an
// estimate, and only sets of 12 or fewer are used. Pure, so it is tested.

import { EXERCISE_MAP, PROGRAM, type Prescription } from "./program.ts";

export type SetLog = {
  day: string;
  workout: string;
  exercise: string;
  position: number;
  kg: number | null;
  reps: number | null;
  rir: number | null;
};

export type SessionLog = { day: string; workout: string; finished: boolean; feel: number | null; notes: string };

export function e1rm(kg: number, reps: number, rir = 0): number | null {
  const total = reps + Math.max(0, rir);
  if (kg <= 0 || reps < 1 || total > 12) return null;
  return total === 1 ? kg : kg * (1 + total / 30);
}

export function roundTo(kg: number, step: number): number {
  if (step <= 0) return kg;
  return Math.round(kg / step) * step;
}

/** The workout after the last finished one: A, B, C, A ... */
export function nextWorkout(sessions: SessionLog[]): string {
  const keys = PROGRAM.workouts.map((w) => w.key);
  const done = sessions.filter((s) => s.finished).sort((a, b) => a.day.localeCompare(b.day));
  const last = done[done.length - 1];
  if (!last) return keys[0];
  return keys[(keys.indexOf(last.workout as never) + 1) % keys.length];
}

export type Target = {
  sets: { kg: number | null; reps: number }[];
  /** up, same, down, or new when there is no history. */
  change: "up" | "same" | "down" | "new";
  why: string;
  rir: number;
};

/** Sessions of one exercise, newest first, each as its sets in order. No weight counts as bodyweight. */
function byDay(history: SetLog[], exercise: string): SetLog[][] {
  const days = new Map<string, SetLog[]>();
  for (const s of history) {
    if (s.exercise !== exercise || s.reps === null) continue;
    days.set(s.day, [...(days.get(s.day) ?? []), { ...s, kg: s.kg ?? 0 }]);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([, sets]) => sets.sort((a, b) => a.position - b.position));
}

/** This far under the reps in reserve asked for, the reps came at the limit: hold the weight. */
const AT_THE_LIMIT = 1;
/** Every set this far over, and the weight is light: add two steps. Ratings are good to about a rep, so not less. */
const ROOM_TO_SPARE = 2;

/** The fewest reps left in the tank on any of these sets, or null when none of them says. */
function fewestLeft(sets: SetLog[]): number | null {
  const logged = sets.flatMap((s) => (s.rir === null ? [] : [s.rir]));
  return logged.length ? Math.min(...logged) : null;
}

export function target(p: Prescription, history: SetLog[], returning: boolean): Target {
  const ex = EXERCISE_MAP.get(p.exercise);
  const rir = p.rir + (returning ? 1 : 0);
  const reps = (n: number) => Array.from({ length: p.sets }, () => ({ kg: null, reps: n }));
  if (!ex || p.scheme === "power" || p.scheme === "timed") {
    return {
      sets: reps(p.reps[0]),
      change: "same",
      why: p.scheme === "power" ? "Full speed every rep. Stop a set if you slow down." : "Hard but repeatable.",
      rir,
    };
  }
  const sessions = byDay(history, p.exercise);
  const last = sessions[0];
  if (!last) {
    const sets =
      p.scheme === "top-backoff"
        ? [{ kg: null, reps: p.reps[0] }, ...Array.from({ length: p.sets - 1 }, () => ({ kg: null, reps: 5 }))]
        : reps(p.reps[0]);
    return { sets, change: "new", why: ex.start ?? `Pick a weight you could do about ${rir + 1} more reps with.`, rir };
  }
  const [lo, hi] = p.reps;
  if (p.scheme === "top-backoff") {
    const top = last.reduce((a, b) => ((b.kg ?? 0) > (a.kg ?? 0) ? b : a));
    const prevTop = sessions[1]?.reduce((a, b) => ((b.kg ?? 0) > (a.kg ?? 0) ? b : a));
    let kg = top.kg!;
    let change: Target["change"] = "same";
    let why = `Same weight: aim for ${Math.min(hi, (top.reps ?? lo) + 1)} reps on the top set.`;
    if ((top.reps ?? 0) >= hi && top.rir !== null && top.rir <= rir - AT_THE_LIMIT) {
      why = `You got ${top.reps} last time, but with ${top.rir} left: same weight, aim for ${hi} with ${rir} in the tank.`;
    } else if ((top.reps ?? 0) >= hi) {
      kg = top.kg! + ex.step;
      change = "up";
      why = `You got ${top.reps} last time: +${ex.step} kg.`;
    } else if ((top.reps ?? 0) < lo && prevTop && (prevTop.reps ?? 0) < lo) {
      kg = roundTo(top.kg! * 0.95, ex.step);
      change = "down";
      why = "Below the range twice: 5% off to build back up.";
    }
    // Back-offs round down: the top set is the hard one.
    const back = ex.step > 0 ? Math.floor((kg * 0.9) / ex.step) * ex.step : kg * 0.9;
    return {
      sets: [{ kg, reps: lo }, ...Array.from({ length: p.sets - 1 }, () => ({ kg: back, reps: 5 }))],
      change,
      why,
      rir,
    };
  }
  // Straight sets. Bodyweight shows as no weight rather than 0 kg.
  const shown = (v: number) => (ex.load === "bodyweight" && v === 0 ? null : v);
  const kg = Math.max(...last.map((s) => s.kg ?? 0));
  const atWeight = last.filter((s) => s.kg === kg);
  const allTop = atWeight.length >= p.sets && atWeight.every((s) => (s.reps ?? 0) >= hi);
  const prev = sessions[1];
  const prevKg = prev ? Math.max(...prev.map((s) => s.kg ?? 0)) : null;
  const under = atWeight.some((s) => (s.reps ?? 0) < lo);
  const prevUnder = prev && prevKg === kg && prev.some((s) => (s.reps ?? 0) < lo);
  if (allTop && ex.step === 0) {
    return {
      sets: Array.from({ length: p.sets }, () => ({ kg: shown(kg), reps: hi })),
      change: "same",
      why: `Top of the range on every set: lower over 3 seconds and pause at the hardest point.`,
      rir,
    };
  }
  const unloaded = ex.load === "bodyweight" && kg === 0;
  // Help from an assisted machine, logged as negative kg.
  const assisted = kg < 0;
  const same = unloaded ? "same again" : assisted ? "same help" : "same weight";
  const left = fewestLeft(atWeight);
  if (allTop && left !== null && left <= rir - AT_THE_LIMIT) {
    return {
      sets: Array.from({ length: p.sets }, () => ({ kg: shown(kg), reps: hi })),
      change: "same",
      why: `All sets hit ${hi}, but with ${left} left: ${same}, aim for ${hi} with ${rir} in the tank.`,
      rir,
    };
  }
  if (allTop) {
    // The first weight on a belt is always the smallest step.
    const light = !unloaded && left !== null && left >= rir + ROOM_TO_SPARE && atWeight.every((s) => s.rir !== null);
    const add = light ? 2 * ex.step : ex.step;
    const why = unloaded
      ? `All sets hit ${hi}: add ${ex.step} kg on a belt, or hold a dumbbell.`
      : assisted
        ? `All sets hit ${hi}${light ? ` with ${left} or more left` : ""}: ${add} kg less help.`
        : light
          ? `All sets hit ${hi} with ${left} or more left: +${add} kg.`
          : `All sets hit ${hi}: +${ex.step} kg.`;
    return { sets: Array.from({ length: p.sets }, () => ({ kg: kg + add, reps: lo })), change: "up", why, rir };
  }
  if (under && prevUnder) {
    const down = assisted ? kg - ex.step : roundTo(kg * 0.95, ex.step);
    return {
      sets: Array.from({ length: p.sets }, () => ({ kg: shown(down), reps: lo })),
      change: "down",
      why: assisted ? `Below the range twice: ${ex.step} kg more help.` : "Below the range twice: 5% off.",
      rir,
    };
  }
  const best = Math.min(...atWeight.map((s) => s.reps ?? 0));
  const aim = Math.min(hi, Math.max(lo, best + 1));
  return {
    sets: Array.from({ length: p.sets }, () => ({ kg: shown(kg), reps: aim })),
    change: "same",
    why: `${same.charAt(0).toUpperCase()}${same.slice(1)}: aim for ${aim} on every set.`,
    rir,
  };
}

/** Best estimated max on each day the lift was done. */
export function e1rmSeries(history: SetLog[], exercise: string): { day: string; e1rm: number }[] {
  const best = new Map<string, number>();
  for (const s of history) {
    if (s.exercise !== exercise || s.kg === null || s.reps === null) continue;
    const e = e1rm(s.kg, s.reps, s.rir ?? 0);
    if (e && e > (best.get(s.day) ?? 0)) best.set(s.day, e);
  }
  return [...best.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, e1rm: Math.round(v * 10) / 10 }));
}

export type Projection = { current: number | null; ratePerWeek: number | null; eta: string | null; note: string };

/**
 * When the goal might arrive at the recent rate. Strength comes back fast after a
 * break and slows once you pass your old best, so the date moves; it is a
 * forecast, recomputed every session, not a promise.
 */
export function project(
  series: { day: string; e1rm: number }[],
  goal: number,
  today: string,
  windowDays = 42,
): Projection {
  const current = series.length ? series[series.length - 1].e1rm : null;
  if (current !== null && current >= goal)
    return { current, ratePerWeek: null, eta: null, note: "Goal reached on the estimate. Time to test a single." };
  const from = Date.parse(`${today}T00:00:00Z`) - windowDays * 86_400_000;
  const pts = series
    .filter((p) => Date.parse(`${p.day}T00:00:00Z`) >= from)
    .map((p) => ({ x: (Date.parse(`${p.day}T00:00:00Z`) - from) / 86_400_000, y: p.e1rm }));
  if (pts.length < 3 || current === null)
    return { current, ratePerWeek: null, eta: null, note: "Needs three heavy bench days to forecast." };
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope = sxx ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const rate = slope * 7;
  if (rate <= 0.05)
    return {
      current,
      ratePerWeek: rate,
      eta: null,
      note: "Flat for now. A deload week or more food usually restarts it.",
    };
  const weeks = (goal - current) / rate;
  const eta = new Date(Date.parse(`${today}T00:00:00Z`) + Math.ceil(weeks * 7) * 86_400_000).toISOString().slice(0, 10);
  return { current, ratePerWeek: rate, eta, note: `At +${rate.toFixed(1)} kg a week.` };
}

/** Sessions done against planned for the week starting `weekStart`, and the run of full weeks before it. */
export function consistency(
  sessions: SessionLog[],
  days: number[],
  weekStart: string,
): { done: number; planned: number; streak: number } {
  const finished = sessions.filter((s) => s.finished).map((s) => s.day);
  const inWeek = (start: string) => {
    const a = Date.parse(`${start}T00:00:00Z`);
    return finished.filter((d) => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return t >= a && t < a + 7 * 86_400_000;
    }).length;
  };
  const planned = days.length;
  let streak = 0;
  for (let w = 1; w < 104; w++) {
    const start = new Date(Date.parse(`${weekStart}T00:00:00Z`) - w * 7 * 86_400_000).toISOString().slice(0, 10);
    if (inWeek(start) >= planned) streak++;
    else break;
  }
  return { done: inWeek(weekStart), planned, streak };
}
