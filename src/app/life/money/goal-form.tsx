"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { saveGoal } from "./actions";

type Kind = "saving" | "sinking" | "debt" | "recurring";

const KINDS: { value: Kind; label: string; amount: string; due: string }[] = [
  { value: "saving", label: "Saving for something", amount: "Target (£)", due: "By (optional)" },
  { value: "sinking", label: "A cost that comes once or each year", amount: "It costs (£)", due: "Due on" },
  { value: "debt", label: "A debt to pay off", amount: "Owed now (£)", due: "Clear by (optional)" },
  { value: "recurring", label: "A regular cost to afford", amount: "It costs (£)", due: "Start on (optional)" },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A bill a regular cost can replace: its merchant, name and price. */
export type Replaceable = { merchantKey: string; name: string; text: string };

/** A goal: what it's for, how much, by when, and where the money is kept. A regular cost: what, how often, and what it replaces. */
export function GoalForm({ bills = [] }: { bills?: Replaceable[] }) {
  const [v, setV] = useState({
    name: "",
    kind: "saving" as Kind,
    amount: "",
    dueOn: "",
    repeatsYearly: false,
    held: "elsewhere" as "account" | "elsewhere",
    saved: "",
    apr: "",
    payment: "",
    cadence: "monthly" as "weekly" | "fortnightly" | "monthly" | "yearly",
    weekday: "",
    setup: "",
    replaces: "",
    overlap: false,
    estimated: false,
  });
  const { pending, run } = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const kind = KINDS.find((k) => k.value === v.kind)!;
  const debt = v.kind === "debt";
  const regular = v.kind === "recurring";

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => saveGoal(v),
          regular ? "Added. Its card says when it fits." : "Added. Move it up or down to change its turn.",
        );
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 sm:col-span-2">
          <span className="field-label">What it&apos;s for</span>
          <input className="field-input" value={v.name} onChange={set("name")} maxLength={60} required />
        </label>
        <label className="block min-w-0 sm:col-span-2">
          <span className="field-label">Kind</span>
          <select
            className="field-input"
            value={v.kind}
            onChange={(e) => {
              const k = e.target.value as Kind;
              setV((x) => ({ ...x, kind: k, held: k === "sinking" || k === "recurring" ? "account" : "elsewhere" }));
            }}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="field-label">{kind.amount}</span>
          <input className="field-input" inputMode="decimal" value={v.amount} onChange={set("amount")} required />
        </label>
        {regular && (
          <label className="block min-w-0">
            <span className="field-label">How often</span>
            <select className="field-input" value={v.cadence} onChange={set("cadence")}>
              <option value="weekly">Each week</option>
              <option value="fortnightly">Every two weeks</option>
              <option value="monthly">Each month</option>
              <option value="yearly">Each year</option>
            </select>
          </label>
        )}
        {regular && (v.cadence === "weekly" || v.cadence === "fortnightly") && (
          <label className="block min-w-0">
            <span className="field-label">On (optional)</span>
            <select className="field-input" value={v.weekday} onChange={set("weekday")}>
              <option value="">The start day&apos;s weekday</option>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={String(i)}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block min-w-0">
          <span className="field-label">{kind.due}</span>
          <input className="field-input" type="date" value={v.dueOn} onChange={set("dueOn")} />
        </label>
        {regular && (
          <>
            <label className="block min-w-0">
              <span className="field-label">Setup cost (£, optional)</span>
              <input
                className="field-input"
                inputMode="decimal"
                value={v.setup}
                onChange={set("setup")}
                placeholder="0"
              />
            </label>
            {bills.length > 0 && (
              <label className="block min-w-0 sm:col-span-2">
                <span className="field-label">It replaces (optional)</span>
                <select className="field-input" value={v.replaces} onChange={set("replaces")}>
                  <option value="">Nothing</option>
                  {bills.map((b) => (
                    <option key={b.merchantKey} value={b.merchantKey}>
                      {b.text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {v.replaces && (
              <label className="flex min-w-0 items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={v.overlap}
                  onChange={(e) => setV((x) => ({ ...x, overlap: e.target.checked }))}
                />
                Pay the old one once more, for its notice
              </label>
            )}
            <label className="flex min-w-0 items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={v.estimated}
                onChange={(e) => setV((x) => ({ ...x, estimated: e.target.checked }))}
              />
              The price is a guess
            </label>
          </>
        )}
        {v.kind === "sinking" && (
          <label className="flex min-w-0 items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={v.repeatsYearly}
              onChange={(e) => setV((x) => ({ ...x, repeatsYearly: e.target.checked }))}
            />
            It comes round every year
          </label>
        )}
        {debt && (
          <>
            <label className="block min-w-0">
              <span className="field-label">Interest (% a year)</span>
              <input className="field-input" inputMode="decimal" value={v.apr} onChange={set("apr")} placeholder="0" />
            </label>
            <label className="block min-w-0">
              <span className="field-label">Monthly payment (£)</span>
              <input className="field-input" inputMode="decimal" value={v.payment} onChange={set("payment")} />
            </label>
          </>
        )}
        {!debt && !regular && (
          <>
            <label className="block min-w-0">
              <span className="field-label">Saved so far (£)</span>
              <input
                className="field-input"
                inputMode="decimal"
                value={v.saved}
                onChange={set("saved")}
                placeholder="0"
              />
            </label>
            <label className="block min-w-0">
              <span className="field-label">Kept</span>
              <select className="field-input" value={v.held} onChange={set("held")}>
                <option value="elsewhere">In a separate saver</option>
                <option value="account">In this account, set aside</option>
              </select>
            </label>
          </>
        )}
      </div>
      <button type="submit" className="btn-life w-full sm:w-auto" disabled={pending} aria-busy={pending}>
        {pending ? "Adding…" : "Add the goal"}
      </button>
    </form>
  );
}
