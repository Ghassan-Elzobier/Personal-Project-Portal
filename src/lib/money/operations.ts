import "server-only";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { moneySyncKey } from "../config/env";
import { keyHash } from "./keys";
import { listAccounts } from "./lunchflow";
import { BankError, type AccountChoice } from "./map";
import { newStatementRows, parseStatement, StatementError } from "./statement";
import { bankMessage } from "./state";
import * as store from "./store";
import { syncBank } from "./sync";

// Every change Money makes from the app. Each returns { error } with a message for
// people instead of throwing. What is stored about an account always comes from
// Lunch Flow's own list, never from what the browser sends.

export type Result<T = object> = ({ error?: undefined } & T) | { error: string };

function refresh() {
  for (const p of ["/life/money", "/"]) revalidatePath(p);
}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const out = await fn();
    refresh();
    return out;
  } catch (e) {
    return {
      error:
        e instanceof BankError
          ? bankMessage(e.code)
          : e instanceof store.MoneyStoreError || e instanceof StatementError
            ? e.message
            : "That didn't work. Try again.",
    };
  }
}

/** The accounts the Lunch Flow key can see, to pick from. */
export function accountsToPick(): Promise<Result<{ accounts: AccountChoice[] }>> {
  return run(async () => ({ accounts: await listAccounts() }));
}

/** Connects the accounts picked (by Lunch Flow's id), then fetches their balance. */
export function connectAccounts(uids: string[]): Promise<Result> {
  return run(async () => {
    const picked = (await listAccounts()).filter((a) => uids.includes(a.uid));
    if (!picked.length) throw new store.MoneyStoreError("Pick an account to connect.");
    await store.connect(picked);
    const synced = await syncBank("connect");
    if (synced.ran && synced.outcome !== "ok") throw new BankError(synced.code);
    return {};
  });
}

/** Fetches Lunch Flow's latest copy now. Does nothing while another sync runs. */
export function refreshBank(): Promise<Result> {
  return run(async () => {
    const synced = await syncBank("owner");
    if (synced.ran && synced.outcome !== "ok") throw new BankError(synced.code);
    return {};
  });
}

export function disconnectBank(): Promise<Result> {
  return run(async () => {
    await store.disconnect();
    return {};
  });
}

/** Erases every bank row: connections, accounts, balances, transactions and syncs. */
export function forgetBank(): Promise<Result> {
  return run(async () => {
    await store.forgetAll();
    return {};
  });
}

/**
 * Lets the scheduled sync in: registers the hash of this deployment's MONEY_SYNC_KEY,
 * worked out here, so the key itself never leaves the server.
 */
export function registerSyncKey(): Promise<Result> {
  return run(async () => {
    const key = moneySyncKey();
    if (!key) throw new store.MoneyStoreError("Add MONEY_SYNC_KEY in Vercel first, then redeploy.");
    await store.setJobKey(keyHash(key), "bank-sync", "Scheduled sync");
    return {};
  });
}

/** Largest statement file taken, in characters (under the server action's 1 MB limit): years of rows fit. */
const MAX_STATEMENT = 900_000;

/**
 * Adds a statement's payments to an account, leaving out any the portal already holds
 * for the same day and amount (from the feed or an earlier statement). The same file
 * twice is refused. The file itself is not kept.
 */
export function uploadStatement(account: number, text: string): Promise<Result<{ added: number; skipped: number }>> {
  return run(async () => {
    if (!text || text.length > MAX_STATEMENT)
      throw new StatementError("That file is empty or too big for a statement.");
    const { rows, from, to } = parseStatement(text);
    const held = (
      (await store.readTransactions(from)) as {
        account_id: number;
        status: string;
        booked_on: string | null;
        pence: number;
      }[]
    ).filter((t) => t.account_id === account && t.status === "booked" && t.booked_on && t.booked_on <= to);
    const { add, skipped } = newStatementRows(rows, held);
    const sha = createHash("sha256").update(text).digest("hex");
    const added = await store.uploadStatement(account, sha, from, to, add, skipped);
    return { added, skipped };
  });
}
