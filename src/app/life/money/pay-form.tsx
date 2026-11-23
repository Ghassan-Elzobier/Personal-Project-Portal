"use client";

import { useState } from "react";
import { parsePounds } from "@/lib/money/budget";
import { pounds } from "@/lib/money/state";
import { LOANS, takeHome, type LoanPlan, type PensionKind } from "@/lib/money/takehome";
import { useAction } from "../kit";
import { saveIncome } from "./actions";

const KINDS: { value: PensionKind; label: string }[] = [
  { value: "net-pay", label: "Taken before tax (net pay)" },
  { value: "salary-sacrifice", label: "Salary sacrifice" },
  { value: "relief-at-source", label: "Taken after tax (relief at source)" },
];

/**
 * A pay step: from a payday on, the take-home a month. Type it, or give the salary a
 * year (with any student loan and pension) and the take-home is worked out as you type.
 * The paydays to pick from follow your payday rule, the next one first.
 */
export function PayForm({ paydays }: { paydays: { day: string; label: string }[] }) {
  const [v, setV] = useState({
    fromOn: paydays[0]?.day ?? "",
    takeHome: "",
    gross: "",
    loan: "" as LoanPlan | "",
    pensionPercent: "",
    pensionKind: "net-pay" as PensionKind,
  });
  const { pending, run } = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const gross = parsePounds(v.gross);
  const worked =
    !v.takeHome && gross
      ? takeHome({
          grossYearPence: gross,
          loans: v.loan ? [v.loan] : [],
          pensionPercent: Number(v.pensionPercent) || 0,
          pensionKind: v.pensionKind,
        })
      : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            saveIncome({
              fromOn: v.fromOn,
              takeHome: v.takeHome,
              gross: v.gross,
              loans: v.loan ? [v.loan] : [],
              pensionPercent: Number(v.pensionPercent) || 0,
              pensionKind: v.pensionKind,
            }),
          "Saved. The forecast follows it.",
        );
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="field-label">From the payday on</span>
          <select className="field-input" value={v.fromOn} onChange={set("fromOn")} required>
            {paydays.map((p) => (
              <option key={p.day} value={p.day}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="field-label">Take-home a month (£)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={v.takeHome}
            onChange={set("takeHome")}
            placeholder="Or the salary below"
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Salary a year (£)</span>
          <input className="field-input" inputMode="decimal" value={v.gross} onChange={set("gross")} />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Student loan</span>
          <select className="field-input" value={v.loan} onChange={set("loan")}>
            <option value="">None</option>
            {(Object.keys(LOANS) as LoanPlan[]).map((k) => (
              <option key={k} value={k}>
                {LOANS[k].name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="field-label">Pension (% of salary)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={v.pensionPercent}
            onChange={set("pensionPercent")}
            placeholder="0"
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Pension taken</span>
          <select className="field-input" value={v.pensionKind} onChange={set("pensionKind")}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {worked && (
        <p className="text-sm text-body tabular-nums" role="status">
          About {pounds(worked.monthPence)} a month after tax ({pounds(Math.round(worked.tax / 12))}) and NI (
          {pounds(Math.round(worked.ni / 12))})
          {worked.loans > 0 && `, student loan (${pounds(Math.round(worked.loans / 12))})`}
          {worked.pension > 0 && `, pension (${pounds(Math.round(worked.pension / 12))})`}.
        </p>
      )}
      <button type="submit" className="btn-life w-full sm:w-auto" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save the pay"}
      </button>
    </form>
  );
}
