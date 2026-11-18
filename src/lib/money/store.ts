import "server-only";
import { anonClient } from "../supabase/anon";
import { rpcAsCaller } from "../supabase/caller";
import { createClient } from "../supabase/server";
import type { TxnRow } from "./feed";
import type { AccountChoice } from "./map";
import type { Apply, GoalAlert } from "./autopilot";
import type { Adoption, BillAlert } from "./recurring";
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
/** The budget's numbers: the owner's page, or Claude at summary. */
export const readBudget = (monthStart: string, weekStart: string) =>
  claude<unknown>("money_budget", { p_month_start: monthStart, p_week_start: weekStart });
export const saveSettings = (settings: Record<string, unknown>) => owner<void>("money_save_settings", { p: settings });
export const savePlanned = (p: Record<string, unknown>) => owner<number>("money_save_planned", { p });
export const cancelPlanned = (id: number) => owner<void>("money_cancel_planned", { p_id: id });
/** Claude at the plan level: save a purchase the owner chose, or change or cancel one Claude added. */
export const claudePlanPurchase = (p: Record<string, unknown>) =>
  claude<{ saved?: number; cancelled?: number }>("money_claude_plan_purchase", { p });
export const claudePlan = (changes: Record<string, unknown>) =>
  claude<{ categories: number; rules: number; unsorted_this_month: number }>("money_claude_plan", {
    p_changes: changes,
  });

export const readMoney = () => owner<unknown>("money_read");
/** A pay step: take-home on each payday from a day on. */
export const saveIncome = (step: { from_on: string; pence: number; gross_year_pence: number | null }) =>
  owner<number>("money_save_income", { p: step });
export const removeIncome = (id: number) => owner<void>("money_remove_income", { p_id: id });
/** A goal: add one, or change one by id. */
export const saveGoal = (goal: Record<string, unknown>) => owner<number>("money_save_goal", { p: goal });
export const removeGoal = (id: number) => owner<void>("money_remove_goal", { p_id: id });
export const moveGoal = (id: number, step: -1 | 1) => owner<void>("money_move_goal", { p_id: id, p_step: step });
/** Claude at the plan level sets the high-level plan (the pay steps, for now). */
export const claudeSetPlan = (plan: Record<string, unknown>) =>
  claude<Record<string, number>>("money_claude_set_plan", { p: plan });
/** Ignore a bill Money found (it is never adopted again), take it back, or rename it. */
export const setBill = (id: number, status: "active" | "ignored" | null, name?: string) =>
  owner<void>("money_set_bill", { p_id: id, p_status: status, p_name: name ?? null });
/** Claude at setup: name, sort, ignore or take back bills. */
export const claudeBills = (changes: Record<string, unknown>[]) =>
  claude<number>("money_claude_bills", { p_changes: changes });
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

/** The engine (engine.ts): payments to find bills in, and the bills as they stand. */
export const engineRead = (since: string, key?: string) =>
  writer<unknown>("money_engine_read", { p_since: since }, key);
export const adoptBills = (bills: Adoption[], key?: string) =>
  writer<number>("money_adopt_bills", { p_bills: bills }, key);
export const markPay = (txn: number, key?: string) => writer<void>("money_mark_pay", { p_txn: txn }, key);
/** The budget's numbers for the engine, with each goal's recent transfers. */
export const engineBudget = (monthStart: string, weekStart: string, key?: string) =>
  writer<unknown>("money_engine_budget", { p_month_start: monthStart, p_week_start: weekStart }, key);
export const engineApply = (apply: Apply, key?: string) => writer<void>("money_engine_apply", { p: apply }, key);
export const raiseAlerts = (alerts: (BillAlert | GoalAlert)[], key?: string) =>
  writer<number>("money_raise_alerts", { p_alerts: alerts }, key);
