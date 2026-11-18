"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { saveSettings } from "./actions";

type Values = { allowance: string; buffer: string; bufferFrom: string; firstPayday: string; paydayRule: string };

const RULES = [
  { value: "last-working-day", label: "The last working day of the month" },
  ...[1, 15, 20, 25, 28].map((d) => ({
    value: `day-${d}`,
    label: `The ${d}${d === 1 ? "st" : "th"} (or the working day before)`,
  })),
];

/** The weekly amount, the buffer and when it starts, and when you're paid. */
export function PlanForm(initial: Values) {
  const [v, setV] = useState(initial);
  const { pending, run } = useAction();
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const rules = RULES.some((r) => r.value === v.paydayRule)
    ? RULES
    : [...RULES, { value: v.paydayRule, label: `The ${v.paydayRule.slice(4)}th (or the working day before)` }];

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
        <label className="block min-w-0">
          <span className="field-label">First payday</span>
          <input className="field-input" type="date" value={v.firstPayday} onChange={set("firstPayday")} />
        </label>
        <label className="block min-w-0 sm:col-span-2">
          <span className="field-label">You&apos;re paid on</span>
          <select className="field-input" value={v.paydayRule} onChange={set("paydayRule")}>
            {rules.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" className="btn-life w-full sm:w-auto" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save the plan"}
      </button>
    </form>
  );
}
