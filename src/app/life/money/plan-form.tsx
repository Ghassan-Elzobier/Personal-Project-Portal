"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { saveSettings } from "./actions";

type Values = {
  allowance: string;
  floor: string;
  buffer: string;
  bufferFrom: string;
};

/** The weekly amount, the buffer and when it starts. When you're paid sits with the pay. */
export function PlanForm(initial: Values) {
  const [v, setV] = useState(initial);
  const { pending, run } = useAction();
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveSettings(v), "Saved. The numbers above follow it.");
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="field-label">To live on each week (£)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={v.allowance}
            onChange={set("allowance")}
            placeholder="From your budgets"
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">The least each week (£)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={v.floor}
            onChange={set("floor")}
            placeholder="Off: the weekly amount stays fixed"
            aria-describedby="floor-help"
          />
          <span id="floor-help" className="mt-1 block text-xs text-muted">
            Set it and each week&apos;s amount moves with your plan, between this and the amount above.
          </span>
        </label>
        <label className="block min-w-0">
          <span className="field-label">Buffer, always kept (£)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={v.buffer}
            onChange={set("buffer")}
            placeholder="0"
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Buffer starts</span>
          <input className="field-input" type="date" value={v.bufferFrom} onChange={set("bufferFrom")} />
        </label>
      </div>
      <button type="submit" className="btn-life w-full sm:w-auto" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save the plan"}
      </button>
    </form>
  );
}
