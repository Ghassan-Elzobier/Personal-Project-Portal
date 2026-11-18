import "server-only";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { dateIn } from "../dates/week";
import { syncFrom } from "./feed";
import { fetchBalance, fetchTransactions } from "./lunchflow";
import { BankError } from "./map";
import * as store from "./store";

// One sync: claim a run (one at a time, held off for an hour after Lunch Flow asks to
// slow down), read each account's balance and transactions, and close the run with
// how it went. The first sync reaches back 15 months; later ones start 10 days before
// the last booked day, because banks book some card payments late, and the overlap
// is free (nothing is stored twice). A failure is stored as a code. Something
// unexpected closes the run and is passed on, so error tracking sees it.

export type SyncResult =
  | { ran: false }
  | { ran: true; outcome: "ok"; booked: number }
  | { ran: true; outcome: "rate-limited" | "failed"; code: string };

export async function syncBank(trigger: "schedule" | "owner" | "connect", key?: string): Promise<SyncResult> {
  const begun = await store.syncBegin(trigger, key);
  if (!begun) return { ran: false };
  const today = dateIn(now(), timeZone());
  try {
    let booked = 0;
    for (const account of begun.accounts) {
      const balance = await fetchBalance(account.uid);
      await store.ingest(begun.run, account.id, [balance], key);
      const rows = await fetchTransactions(account.uid, syncFrom(account.latest, today), today);
      booked += await store.ingestTransactions(begun.run, account.id, rows.booked, rows.pending, key);
    }
    await store.syncEnd(begun.run, "ok", null, key);
    return { ran: true, outcome: "ok", booked };
  } catch (e) {
    const code = e instanceof BankError ? e.code : "UNEXPECTED";
    const outcome = code === "HTTP_429" ? "rate-limited" : "failed";
    await store.syncEnd(begun.run, outcome, code, key).catch(() => undefined);
    if (!(e instanceof BankError)) throw e;
    return { ran: true, outcome, code };
  }
}
