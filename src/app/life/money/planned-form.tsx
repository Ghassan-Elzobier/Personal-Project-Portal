"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { savePlanned } from "./actions";

/** Plan a purchase: what, how much, when, and how it's paid for. */
export function PlannedForm({ today }: { today: string }) {
  const empty = { name: "", amount: "", dueOn: today, funding: "allowance", weeks: 3 };
  const [v, setV] = useState(empty);
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  if (!open) {
    return (
      <button type="button" className="btn-soft" onClick={() => setOpen(true)}>
        Plan a purchase
      </button>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await savePlanned(v);
          if (r.error === undefined) {
            setV(empty);
            setOpen(false);
          }
          return r;
        }, "Planned. This week and payday count it now.");
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="field-label">What for</span>
          <input
            className="field-input"
            value={v.name}
            maxLength={60}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="Bike repair"
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Cost (£)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={v.amount}
            onChange={(e) => setV({ ...v, amount: e.target.value })}
            placeholder="60"
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">When you&apos;ll pay</span>
          <input
            className="field-input"
            type="date"
            value={v.dueOn}
            onChange={(e) => setV({ ...v, dueOn: e.target.value })}
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Paid for</span>
          <select className="field-input" value={v.funding} onChange={(e) => setV({ ...v, funding: e.target.value })}>
            <option value="allowance">From that week&apos;s amount</option>
            <option value="spread">Spread over a few weeks</option>
            <option value="safe">From what&apos;s safe before payday</option>
          </select>
        </label>
        {v.funding === "spread" && (
          <label className="block min-w-0">
            <span className="field-label">Weeks</span>
            <select
              className="field-input"
              value={v.weeks}
              onChange={(e) => setV({ ...v, weeks: Number(e.target.value) })}
            >
              {[2, 3, 4, 6, 8].map((w) => (
                <option key={w} value={w}>
                  {w} weeks
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-life" disabled={pending} aria-busy={pending}>
          {pending ? "Planning…" : "Plan it"}
        </button>
        <button type="button" className="btn-soft" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
