"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { saveGoal } from "./actions";

type Kind = "saving" | "sinking" | "debt";

const KINDS: { value: Kind; label: string; amount: string; due: string }[] = [
  { value: "saving", label: "Saving for something", amount: "Target (£)", due: "By (optional)" },
  { value: "sinking", label: "A cost that comes once or each year", amount: "It costs (£)", due: "Due on" },
  { value: "debt", label: "A debt to pay off", amount: "Owed now (£)", due: "Clear by (optional)" },
];

/** A goal: what it's for, how much, by when, and where the money is kept. */
export function GoalForm() {
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
  });
  const { pending, run } = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const kind = KINDS.find((k) => k.value === v.kind)!;
  const debt = v.kind === "debt";

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveGoal(v), "Added. Move it up or down to change its turn.");
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
              setV((x) => ({ ...x, kind: k, held: k === "sinking" ? "account" : "elsewhere" }));
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
        <label className="block min-w-0">
          <span className="field-label">{kind.due}</span>
          <input className="field-input" type="date" value={v.dueOn} onChange={set("dueOn")} />
        </label>
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
        {debt ? (
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
        ) : (
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
