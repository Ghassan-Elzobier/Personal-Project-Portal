import "server-only";
import { anonClient } from "../supabase/anon";
import { createClient } from "../supabase/server";
import type { AccountChoice } from "./map";

// The Money tables, through their RPCs (supabase/migrations/*_money_connect.sql).
// Owner calls use the browser session only: the Claude connector never reaches
// these. Sync calls use the session too, or a job's key with the anon client.

export class MoneyStoreError extends Error {}

type Failure = { code: string };

function failure(name: string, error: Failure): MoneyStoreError {
  if (error.code === "PGRST202") return new MoneyStoreError("The Money tables are not in the database yet.");
  if (error.code === "42501") return new MoneyStoreError("Only the owner can use Money.");
  // The code only: a database message can carry values, and errors become public issues.
  console.error(name, error.code);
  return new MoneyStoreError(
    error.code === "22023" || error.code === "23514"
      ? "Those values are not valid."
      : "The database did not answer. Try again in a minute.",
  );
}

async function owner<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (await createClient()).rpc(name, args);
  if (error) throw failure(name, error);
  return data as T;
}

/** A sync RPC: with a job's key through the anon client, or else as the signed-in owner. */
async function writer<T>(name: string, args: Record<string, unknown>, key?: string): Promise<T> {
  const client = key ? anonClient() : await createClient();
  const { data, error } = await client.rpc(name, key ? { ...args, p_sync_key: key } : args);
  if (error) throw failure(name, error);
  return data as T;
}

export const readMoney = () => owner<unknown>("money_read");
export const connect = (accounts: AccountChoice[]) => owner<number[]>("money_connect", { p_accounts: accounts });
export const disconnect = () => owner<void>("money_disconnect");
export const forgetAll = () => owner<void>("money_forget_all");

export type SyncStart = { run: number; accounts: { id: number; uid: string }[] };
export type SyncOutcome = "ok" | "skipped" | "rate-limited" | "failed";

export const syncBegin = (trigger: "schedule" | "owner" | "connect", key?: string) =>
  writer<SyncStart | null>("money_sync_begin", { p_trigger: trigger }, key);
export const ingest = (run: number, account: number, balances: { kind: string; pence: number }[], key?: string) =>
  writer<void>("money_ingest", { p_run: run, p_account: account, p_balances: balances }, key);
export const syncEnd = (run: number, outcome: SyncOutcome, code: string | null, key?: string) =>
  writer<void>("money_sync_end", { p_run: run, p_outcome: outcome, p_error_code: code }, key);
