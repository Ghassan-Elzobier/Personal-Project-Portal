import "server-only";
import { lunchflowBase, lunchflowKey } from "../config/env";
import { feedRows, transactionsPath } from "./feed";
import { accountChoices, balanceOf, BankError, type AccountChoice } from "./map";

// Lunch Flow's Personal API: read only, with one key that lives in Vercel. It reads
// Lunch Flow's own copy of the bank's data, so calling it never reaches the bank.
// Failures become codes (BANK_SYNC:HTTP_401), never Lunch Flow's own words, and no
// answer is ever logged.

const TIMEOUT_MS = 20_000;

/** Whether the key is set, so Money can offer to connect. */
export function lunchflowReady(): boolean {
  return lunchflowKey() !== null;
}

async function get(path: string): Promise<unknown> {
  const key = lunchflowKey();
  if (!key) throw new BankError("NO_KEY");
  let res: Response;
  try {
    res = await fetch(`${lunchflowBase()}${path}`, {
      headers: { "x-api-key": key, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new BankError(e instanceof Error && e.name === "TimeoutError" ? "TIMEOUT" : "NETWORK");
  }
  if (!res.ok) throw new BankError(`HTTP_${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new BankError("BAD_JSON");
  }
}

/** The accounts the key can see, named by type with their last 4 digits. */
export async function listAccounts(): Promise<AccountChoice[]> {
  return accountChoices(await get("/accounts?include_raw=true"));
}

/** One account's balance, in pence. */
export async function fetchBalance(uid: string): Promise<{ kind: "available"; pence: number }> {
  return balanceOf(await get(`/accounts/${encodeURIComponent(uid)}/balance`));
}

/** One account's transactions from a day on, pending ones too, with the bank's raw record for exact amounts. */
export async function fetchTransactions(
  uid: string,
  from: string,
  today: string,
): Promise<ReturnType<typeof feedRows>> {
  return feedRows(await get(transactionsPath(uid, from)), today);
}
