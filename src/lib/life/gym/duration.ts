// How long a gym session takes, worked out from what it asks for, so the Life
// plan's gym block, Today and the session page give the time a session really
// needs. The block used to be a number typed into Settings, and a session asking
// for 35 sets ran far past it.
//
// Every set costs its set-up, its reps and the seconds to log it, plus the rest
// before the next set in the session's order (next-set.ts). In a pair that next set
// is the partner's, so the partner is done inside the main lift's rest. Each block
// adds a change-over and its ramp-up sets, and the warm-up and recovery are the
// seconds on their steps. The pace below is a middling one; the owner's own set
// times can refine it later.
//
// `plan` keeps every core block, then adds the optional blocks in order while the
// session still fits the time the owner has. Pure, so it is tested.

import { nextSet, setId } from "./next-set.ts";
import { resolve, type Block, type Load, type Prescription, type Step, type Workout } from "./program.ts";

type Kind = "barbell" | "dumbbell" | "machine" | "bodyweight";

/** Seconds a set costs, by the kind of load it uses. */
export type Pace = {
  /** Seconds per rep. */
  rep: Record<Kind, number>;
  /** Getting into position: unracking, picking up the dumbbells, setting the pin. */
  setup: Record<Kind, number>;
  /** Filling in and ticking the set on the phone. */
  log: number;
  /** Changing sides on a move done on each side. */
  side: number;
  /** One ramp-up set, plates included. */
  ramp: number;
  /** Moving to the next block's stations. */
  change: number;
  /** The lifter's own extra seconds a set, 0 until learned. */
  extra: number;
};

export const DEFAULT_PACE: Pace = {
  rep: { barbell: 4, dumbbell: 3.5, machine: 3, bodyweight: 3 },
  setup: { barbell: 20, dumbbell: 10, machine: 8, bodyweight: 5 },
  log: 8,
  side: 5,
  ramp: 60,
  change: 120,
  extra: 0,
};

const kindOf = (load: Load): Kind =>
  load === "barbell" || load === "dumbbell" || load === "machine" ? load : "bodyweight";

/** Seconds one set takes, without the rest after it. A timed set's reps are its seconds. */
export function setSeconds(p: Prescription, missing: string[] = [], pace: Pace = DEFAULT_PACE): number {
  const ex = resolve(p.exercise, missing);
  const kind = p.scheme === "timed" ? "bodyweight" : kindOf(ex?.load ?? "bodyweight");
  const sides = ex?.perSide ? 2 : 1;
  const reps = Math.ceil((p.reps[0] + p.reps[1]) / 2);
  const work = p.scheme === "timed" ? reps * sides : reps * pace.rep[kind] * sides;
  return pace.setup[kind] + work + (sides === 2 ? pace.side : 0) + pace.log + pace.extra;
}

/** The block's sets in the order the session page gives them, as indexes into its items. */
export function setOrder(block: Block): number[] {
  const shape = {
    superset: Boolean(block.superset),
    items: block.items.map((p, i) => ({ key: `${i}`, sets: p.sets })),
  };
  const logged = new Set<string>();
  const order: number[] = [];
  for (let next = nextSet([shape], logged); next; next = nextSet([shape], logged)) {
    logged.add(setId(next.key, next.position));
    order.push(Number(next.key));
  }
  return order;
}

/** Seconds a block takes: the change-over, its ramp-up sets, every set and every rest but the last. */
export function blockSeconds(block: Block, missing: string[] = [], pace: Pace = DEFAULT_PACE): number {
  const order = setOrder(block);
  const ramps = block.items.reduce((n, p) => n + (p.ramp?.length ?? 0), 0);
  return order.reduce(
    (t, i, n) => t + setSeconds(block.items[i], missing, pace) + (n < order.length - 1 ? block.items[i].rest : 0),
    pace.change + ramps * pace.ramp,
  );
}

const stepSeconds = (steps: Step[], optional: boolean) =>
  steps.filter((s) => Boolean(s.optional) === optional).reduce((t, s) => t + s.seconds, 0);

export type Estimate = {
  /** Seconds of each block, in order. */
  blocks: number[];
  /** The warm-up and recovery steps everyone does. */
  steps: number;
  /** The optional warm-up and recovery steps. */
  optionalSteps: number;
  /** The session without anything optional. */
  core: number;
  /** The session with everything. */
  full: number;
};

export function estimate(w: Workout, missing: string[] = [], pace: Pace = DEFAULT_PACE): Estimate {
  const blocks = w.blocks.map((b) => blockSeconds(b, missing, pace));
  const steps = stepSeconds(w.warmup, false) + stepSeconds(w.recovery, false);
  const optionalSteps = stepSeconds(w.warmup, true) + stepSeconds(w.recovery, true);
  const core = blocks.reduce((t, s, i) => t + (w.blocks[i].optional ? 0 : s), steps);
  const full = blocks.reduce((t, s) => t + s, steps + optionalSteps);
  return { blocks, steps, optionalSteps, core, full };
}

export type Plan = {
  /** Whether each block is in today's session: every core block, and the extras that fit. */
  blocks: boolean[];
  /** Whether the optional warm-up and recovery steps fit as well. */
  steps: boolean;
  /** Seconds the planned session takes. */
  seconds: number;
  /** Minutes for the calendar: the planned seconds rounded up to 5 minutes. */
  minutes: number;
};

/**
 * Today's session for the time the owner has. The core always stays, so a short
 * budget gets the core alone. Extras are added in order and stop at the first that
 * doesn't fit, so a later extra never takes the place of an earlier one; the
 * optional steps come last.
 */
export function plan(w: Workout, budgetMinutes: number, missing: string[] = [], pace: Pace = DEFAULT_PACE): Plan {
  const e = estimate(w, missing, pace);
  const budget = budgetMinutes * 60;
  const blocks = w.blocks.map((b) => !b.optional);
  let seconds = e.core;
  let room = true;
  w.blocks.forEach((b, i) => {
    if (!b.optional || !room) return;
    if (seconds + e.blocks[i] <= budget) {
      blocks[i] = true;
      seconds += e.blocks[i];
    } else room = false;
  });
  const steps = room && e.optionalSteps > 0 && seconds + e.optionalSteps <= budget;
  if (steps) seconds += e.optionalSteps;
  return { blocks, steps, seconds, minutes: Math.ceil(seconds / 300) * 5 };
}
