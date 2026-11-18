import "server-only";
import { revalidatePath } from "next/cache";
import { listAccounts } from "./lunchflow";
import { BankError, type AccountChoice } from "./map";
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
          : e instanceof store.MoneyStoreError
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

/** Erases every bank row: connections, accounts, balances and syncs. */
export function forgetBank(): Promise<Result> {
  return run(async () => {
    await store.forgetAll();
    return {};
  });
}
