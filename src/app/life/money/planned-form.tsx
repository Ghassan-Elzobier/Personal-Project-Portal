"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import type { AffordCheck } from "@/lib/money/displaces";
import { useAction } from "../kit";
import { checkAfford, savePlanned } from "./actions";

const VERDICT: Record<AffordCheck["verdict"], string> = {
  fits: "text-mint",
  tight: "text-sand",
  out: "text-coral",
  unknown: "text-muted",
};

/** Plan a purchase: what, how much, when, and how it's paid for. "Can I afford it?" answers before you choose. */
export function PlannedForm({ today }: { today: string }) {
  const empty = { name: "", amount: "", dueOn: today, funding: "allowance", weeks: 3 };
  const [v, setV] = useState(empty);
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  // The answer belongs to the cost it was asked for: change the cost and it is gone, so it can't go stale.
  const [answer, setAnswer] = useState<{ amount: string; check: AffordCheck; displaces: string } | null>(null);
  const [checking, startCheck] = useTransition();
  const asked = answer && answer.amount === v.amount ? answer : null;
  const check = asked?.check ?? null;

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
      <div aria-live="polite">
        {check && (
          <div className="space-y-2 rounded-xl bg-white/5 p-3 text-sm">
            <p className={VERDICT[check.verdict]}>{check.reason}</p>
            {asked?.displaces && <p className="text-muted">{asked.displaces}</p>}
            {check.options.length > 0 && (
              <ul className="space-y-2" aria-label="Ways to pay for it">
                {check.options.map((o) => {
                  const chosen = v.funding === o.funding && (o.funding !== "spread" || v.weeks === o.weeks);
                  return (
                    <li key={`${o.funding}-${o.weeks}`}>
                      <button
                        type="button"
                        aria-pressed={chosen}
                        onClick={() =>
                          setV({ ...v, funding: o.funding, weeks: o.funding === "spread" ? o.weeks : v.weeks })
                        }
                        className={`tap w-full justify-start px-3 py-2 text-left text-sm ring-1 ${chosen ? "bg-mint/15 text-white ring-mint/40" : "bg-white/8 text-bright ring-white/10 hover:bg-white/15"}`}
                      >
                        {o.text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-life" disabled={pending} aria-busy={pending}>
          {pending ? "Planning…" : "Plan it"}
        </button>
        <button
          type="button"
          className="btn-soft"
          disabled={checking || v.amount.trim() === ""}
          aria-busy={checking}
          onClick={() =>
            startCheck(async () => {
              const amount = v.amount;
              const r = await checkAfford(amount);
              if (r.error !== undefined) return void toast(r.error, { tone: "error" });
              setAnswer({ amount, check: r.check, displaces: r.displaces });
            })
          }
        >
          Can I afford it?
        </button>
        <button type="button" className="btn-soft" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
