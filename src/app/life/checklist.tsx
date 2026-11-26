"use client";

import { useState } from "react";

/** One step: what to do, how long it takes, and whether it can be left out. */
export type TimedStep = { text: string; seconds: number; optional: boolean };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * A timed checklist under a heading that says how long it takes, counting only the
 * steps everyone does: the gym's warm-up before the first set and its recovery
 * after the last. The ticks are for the moment, so nothing is saved.
 */
export function TimedChecklist({ id, title, steps }: { id: string; title: string; steps: TimedStep[] }) {
  const [ticked, setTicked] = useState<boolean[]>(() => steps.map(() => false));
  const minutes = Math.round(steps.filter((s) => !s.optional).reduce((t, s) => t + s.seconds, 0) / 60);
  return (
    <section className="space-y-2 card-life" aria-labelledby={id}>
      <h2 id={id} className="font-semibold">
        {title} · {minutes} min
      </h2>
      <ul className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.text}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
              <input
                type="checkbox"
                checked={ticked[i]}
                onChange={() => setTicked((x) => x.map((v, j) => (j === i ? !v : v)))}
                className="mt-0.5 size-5 shrink-0 accent-mint"
              />
              <span className={ticked[i] ? "text-faint line-through" : ""}>
                <span className="text-muted tabular-nums">{clock(s.seconds)}</span> {s.optional ? "Optional. " : ""}
                {s.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
