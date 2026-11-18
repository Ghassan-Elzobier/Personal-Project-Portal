"use client";

import { useState } from "react";
import { Empty } from "@/components/ui";
import type { AccountChoice } from "@/lib/money/map";
import { ActionButton, useAction } from "../kit";
import { bankAccounts, connectBank } from "./actions";

/**
 * Connect: asks Lunch Flow which accounts the key can see, then connects the ones
 * you tick (the current account to start with). Only the type and last 4 digits show.
 */
export function ConnectBank({ again }: { again: boolean }) {
  const [accounts, setAccounts] = useState<AccountChoice[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { pending, run } = useAction();

  if (!accounts) {
    return (
      <button
        type="button"
        className="btn-life"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          void run(async () => {
            const r = await bankAccounts();
            if (r.error === undefined) {
              setAccounts(r.accounts);
              setPicked(new Set(r.accounts.filter((a) => a.kind === "current").map((a) => a.uid)));
            }
            return r;
          })
        }
      >
        {pending ? "Asking Lunch Flow…" : again ? "Connect again" : "Connect Lunch Flow"}
      </button>
    );
  }
  if (!accounts.length) {
    return (
      <Empty>The key can&apos;t see any accounts. In Lunch Flow, check the destination&apos;s Account Access.</Empty>
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="field-label">Which accounts should Money read?</legend>
      <ul className="space-y-2">
        {accounts.map((a) => (
          <li key={a.uid}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-mint"
                checked={picked.has(a.uid)}
                onChange={() =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (next.has(a.uid)) next.delete(a.uid);
                    else next.add(a.uid);
                    return next;
                  })
                }
              />
              <span>
                {a.name}
                {a.last4 && <span className="text-muted tabular-nums"> ••{a.last4}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ActionButton
        action={() => connectBank([...picked])}
        className="btn-life w-full sm:w-auto"
        disabled={!picked.size}
        done="Connected. The balance is in."
      >
        Connect {picked.size === 1 ? "this account" : `${picked.size} accounts`}
      </ActionButton>
    </fieldset>
  );
}
