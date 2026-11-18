"use client";

import { useState } from "react";
import { useAction } from "../../kit";
import { uploadStatement } from "../actions";

/** Picks a CSV statement, reads it in the browser and sends its text to be added. */
export function StatementForm({ accounts }: { accounts: { id: number; label: string }[] }) {
  const [account, setAccount] = useState(accounts[0]?.id ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { pending, run } = useAction();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        setResult(null);
        void run(async () => {
          const r = await uploadStatement(account, await file.text());
          if (r.error === undefined)
            setResult(
              `Added ${r.added} ${r.added === 1 ? "payment" : "payments"}` +
                (r.skipped
                  ? `; ${r.skipped} the portal already had ${r.skipped === 1 ? "was" : "were"} left out.`
                  : "."),
            );
          return r;
        });
      }}
    >
      {accounts.length > 1 && (
        <label className="block">
          <span className="field-label">Account</span>
          <select className="field-input" value={account} onChange={(e) => setAccount(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="field-label">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="field-input file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-bright"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <button type="submit" className="btn-life w-full sm:w-auto" disabled={!file || pending} aria-busy={pending}>
        {pending ? "Adding…" : "Add the statement"}
      </button>
      {result && (
        <p role="status" className="rounded-xl bg-mint/10 p-3 text-sm text-mint ring-1 ring-mint/30">
          {result}
        </p>
      )}
    </form>
  );
}
