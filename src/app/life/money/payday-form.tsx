"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { savePayday } from "./actions";

const RULES = [
  { value: "last-working-day", label: "The last working day of the month" },
  ...[1, 15, 20, 25, 28].map((d) => ({
    value: `day-${d}`,
    label: `The ${d}${d === 1 ? "st" : "th"} (or the working day before)`,
  })),
];

/** When you're paid: the rule every payday follows, and the first payday. */
export function PaydayForm(initial: { firstPayday: string; paydayRule: string }) {
  const [v, setV] = useState(initial);
  const { pending, run } = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const rules = RULES.some((r) => r.value === v.paydayRule)
    ? RULES
    : [...RULES, { value: v.paydayRule, label: `The ${v.paydayRule.slice(4)}th (or the working day before)` }];

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => savePayday(v), "Saved. Your paydays follow it.");
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="field-label">You&apos;re paid on</span>
          <select className="field-input" value={v.paydayRule} onChange={set("paydayRule")}>
            {rules.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="field-label">First payday</span>
          <input
            className="field-input"
            type="date"
            value={v.firstPayday}
            onChange={set("firstPayday")}
            aria-describedby="first-payday-help"
          />
          <span id="first-payday-help" className="mt-1 block text-xs text-muted">
            For a new job: no pay is counted before it.
          </span>
        </label>
      </div>
      <button type="submit" className="btn-soft w-full sm:w-auto" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save when you're paid"}
      </button>
    </form>
  );
}
