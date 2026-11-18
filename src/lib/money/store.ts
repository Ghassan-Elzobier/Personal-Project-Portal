import "server-only";
import { anonClient } from "../supabase/anon";
import { rpcAsCaller } from "../supabase/caller";
import { createClient } from "../supabase/server";
import type { TxnRow } from "./feed";
import type { AccountChoice } from "./map";
import type { StatementRow } from "./statement";

// The Money tables, through their RPCs (supabase/migrations/*_money_*.sql). Owner
// calls use the browser session only: the Claude connector never reaches these.
// Sync calls use the session too, or a job's key with the anon client.

export class MoneyStoreError extends Error {}

type Failure = { code: string; message: string };

function failure(name: string, error: Failure): MoneyStoreError {
  if (error.code === "PGRST202") return new MoneyStoreError("The Money tables are not in the database yet.");
  if (error.code === "42501") return new MoneyStoreError("Only the owner can use Money.");
  // The RPCs' own messages for people ("That statement is in already."), which carry no values.
  if (error.code === "P0001") return new MoneyStoreError(error.message);
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

/**
 * A Claude RPC: the token's hash goes with a connector call (rpcAsCaller). Its refusals
 * say what to do ("…The owner can change it on the Money page."), so they pass on.
 */
async function claude<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpcAsCaller(name, args);
  if (error) {
    if (error.code === "42501" || error.code === "P0001") throw new MoneyStoreError(error.message);
    throw failure(name, error);
  }
  return data as T;
}

export const claudeHistory = (months: number) => claude<unknown>("money_claude_history", { p_months: months });
export const claudePlan = (changes: Record<string, unknown>) =>
  claude<{ categories: number; rules: number; unsorted_this_month: number }>("money_claude_plan", {
    p_changes: changes,
  });

export const readMoney = () => owner<unknown>("money_read");
export const readTransactions = (since: string) => owner<unknown[]>("money_transactions", { p_since: since });
export const connect = (accounts: AccountChoice[]) => owner<number[]>("money_connect", { p_accounts: accounts });
export const disconnect = () => owner<void>("money_disconnect");
export const forgetAll = () => owner<void>("money_forget_all");
export const setJobKey = (hash: string, scope: "bank-sync" | "trolley", label: string) =>
  owner<void>("job_key_set", { p_hash: hash, p_scope: scope, p_label: label });
export const setCategory = (txn: number, category: number | null, always: boolean) =>
  owner<void>("money_set_category", { p_txn: txn, p_category: category, p_always: always });
export const dismissAlert = (id: number) => owner<void>("money_dismiss_alert", { p_id: id });
export const setClaudeAccess = (level: "off" | "summary" | "plan" | "setup") =>
  owner<void>("money_set_claude_access", { p_level: level });
export const uploadStatement = (
  account: number,
  sha256: string,
  from: string,
  to: string,
  rows: StatementRow[],
  skipped: number,
) =>
  owner<number>("money_upload_statement", {
    p_account: account,
    p_file_sha256: sha256,
    p_from: from,
    p_to: to,
    p_rows: rows,
    p_skipped: skipped,
  });

export type SyncStart = { run: number; accounts: { id: number; uid: string; latest: string | null }[] };
export type SyncOutcome = "ok" | "skipped" | "rate-limited" | "failed";

export const syncBegin = (trigger: "schedule" | "owner" | "connect", key?: string) =>
  writer<SyncStart | null>("money_sync_begin", { p_trigger: trigger }, key);
export const ingest = (run: number, account: number, balances: { kind: string; pence: number }[], key?: string) =>
  writer<void>("money_ingest", { p_run: run, p_account: account, p_balances: balances }, key);
export const ingestTransactions = (run: number, account: number, booked: TxnRow[], pending: TxnRow[], key?: string) =>
  writer<number>(
    "money_ingest_transactions",
    { p_run: run, p_account: account, p_booked: booked, p_pending: pending },
    key,
  );
export const syncEnd = (run: number, outcome: SyncOutcome, code: string | null, key?: string) =>
  writer<void>("money_sync_end", { p_run: run, p_outcome: outcome, p_error_code: code }, key);
