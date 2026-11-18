import "server-only";
import { fetchBalance } from "./lunchflow";
import { BankError } from "./map";
import * as store from "./store";

// One sync: claim a run (one at a time, held off for an hour after Lunch Flow asks to
// slow down), read each account's balance, and close the run with how it went. A
// failure is stored as a code. Something unexpected closes the run and is passed on,
// so error tracking sees it.

export type SyncResult =
  { ran: false } | { ran: true; outcome: "ok" } | { ran: true; outcome: "rate-limited" | "failed"; code: string };

export async function syncBank(trigger: "schedule" | "owner" | "connect", key?: string): Promise<SyncResult> {
  const begun = await store.syncBegin(trigger, key);
  if (!begun) return { ran: false };
  try {
    for (const account of begun.accounts) {
      const balance = await fetchBalance(account.uid);
      await store.ingest(begun.run, account.id, [balance], key);
    }
    await store.syncEnd(begun.run, "ok", null, key);
    return { ran: true, outcome: "ok" };
  } catch (e) {
    const code = e instanceof BankError ? e.code : "UNEXPECTED";
    const outcome = code === "HTTP_429" ? "rate-limited" : "failed";
    await store.syncEnd(begun.run, outcome, code, key).catch(() => undefined);
    if (!(e instanceof BankError)) throw e;
    return { ran: true, outcome, code };
  }
}
