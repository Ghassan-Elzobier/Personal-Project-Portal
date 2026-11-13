"use client";

import { useState } from "react";
import { logWeight } from "../actions";
import { useAction } from "../kit";

/** Today's weigh-in: one number, one tap. Starts from yesterday's so it is usually a nudge. */
export function WeighIn({ today, todays, last }: { today: string; todays: number | null; last: number | null }) {
  const [kg, setKg] = useState((todays ?? last ?? "").toString());
  const { pending, run } = useAction();
  const n = Number(kg);
  const valid = kg.trim() !== "" && Number.isFinite(n) && n >= 30 && n <= 250;
  const bump = (d: number) => setKg((v) => (Math.round(((Number(v) || last || 0) + d) * 10) / 10).toFixed(1));
  return (
    <section className="space-y-3 card-life" aria-labelledby="weigh-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="weigh-title" className="text-lg font-semibold">
          {todays !== null ? "Today's weigh-in" : "Weigh in"}
        </h2>
        {todays !== null && <span className="text-sm text-mint">Logged</span>}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void run(() => logWeight(today, Math.round(n * 10) / 10), "Weigh-in saved.");
        }}
      >
        <button
          type="button"
          onClick={() => bump(-0.1)}
          className="tap h-14 w-12 rounded-xl bg-white/5 text-2xl"
          aria-label="0.1 kg less"
        >
          −
        </button>
        <label className="flex items-baseline gap-2">
          <span className="sr-only">Weight in kg</span>
          <input
            inputMode="decimal"
            value={kg}
            onChange={(e) => setKg(e.target.value.replace(",", "."))}
            className="h-14 w-28 rounded-xl bg-white/10 text-center text-3xl font-bold tabular-nums"
            aria-invalid={kg !== "" && !valid}
          />
          <span className="text-muted">kg</span>
        </label>
        <button
          type="button"
          onClick={() => bump(0.1)}
          className="tap h-14 w-12 rounded-xl bg-white/5 text-2xl"
          aria-label="0.1 kg more"
        >
          +
        </button>
        <button type="submit" disabled={!valid || pending} aria-busy={pending} className="ml-auto btn-life h-14 px-6">
          {todays !== null ? "Update" : "Save"}
        </button>
      </form>
    </section>
  );
}
