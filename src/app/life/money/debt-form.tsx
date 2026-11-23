"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { addDebtFromBill } from "./actions";

/** A repayment Money found, made a debt to watch: what's owed now, and its interest if known. */
export function DebtForm({ billId, name }: { billId: number; name: string }) {
  const [owed, setOwed] = useState("");
  const [apr, setApr] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="space-y-2"
      aria-label={`Watch ${name} clear`}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => addDebtFromBill(billId, owed, apr), "Added. Its repayments count it down.");
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="field-label">Owed now (£)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={owed}
            onChange={(e) => setOwed(e.target.value)}
            required
          />
        </label>
        <label className="block min-w-0">
          <span className="field-label">Interest % a year (optional)</span>
          <input
            className="field-input"
            inputMode="decimal"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
            placeholder="0"
          />
        </label>
      </div>
      <button
        type="submit"
        className="btn-soft px-3 py-1.5 text-xs"
        disabled={pending}
        aria-busy={pending}
        aria-label={`Add ${name}`}
      >
        {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
