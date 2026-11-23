import "server-only";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { moneySyncKey, timeZone } from "../config/env";
import { now } from "../dates/clock";
import { dateIn } from "../dates/week";
import { suggestGoals } from "./allocate";
import { mondayOf, monthStart, parseBudget, parsePounds } from "./budget";
import { affordCheck, displacesText, type AffordCheck } from "./displaces";
import { keyHash } from "./keys";
import { listAccounts } from "./lunchflow";
import { BankError, type AccountChoice } from "./map";
import { newStatementRows, parseStatement, StatementError } from "./statement";
import { bankMessage } from "./state";
import * as store from "./store";
import { syncBank } from "./sync";
import { LOANS, takeHome, type LoanPlan, type PensionKind } from "./takehome";

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

/**
 * Sorts a payment by hand (null: back to the rules). With `always`, the merchant gets a
 * rule too, which sorts its past payments and every one after.
 */
export function setCategory(txn: number, category: number | null, always: boolean): Promise<Result> {
  return run(async () => {
    await store.setCategory(txn, category, always);
    return {};
  });
}

/** Ignores a bill Money found (it stops counting and is never found again), or takes it back. */
export function setBill(id: number, status: "active" | "ignored"): Promise<Result> {
  return run(async () => {
    await store.setBill(id, status);
    return {};
  });
}

export function dismissAlert(id: number): Promise<Result> {
  return run(async () => {
    await store.dismissAlert(id);
    return {};
  });
}

export type SettingsInput = {
  allowance: string;
  /** The least to live on a week; set, the weekly amount moves with the plan. */
  floor?: string;
  buffer: string;
  bufferFrom: string;
  firstPayday: string;
  paydayRule: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function poundsToPence(text: string): number | null {
  const p = parsePounds(text);
  if (p === undefined) throw new store.MoneyStoreError("Amounts are in pounds, like 160 or 160.50.");
  return p;
}

/** The weekly amount, the buffer and when it starts, and the payday. */
export function saveSettings(input: SettingsInput): Promise<Result> {
  return run(async () => {
    for (const d of [input.bufferFrom, input.firstPayday])
      if (d && !DAY.test(d)) throw new store.MoneyStoreError("Dates look like 2027-01-29.");
    if (!/^(last-working-day|day-([1-9]|[12][0-9]|3[01]))$/.test(input.paydayRule))
      throw new store.MoneyStoreError("Pick when you're paid.");
    const floor = poundsToPence(input.floor ?? "");
    const allowance = poundsToPence(input.allowance);
    if (floor !== null && allowance !== null && floor > allowance)
      throw new store.MoneyStoreError("The least a week can't be more than the amount to live on.");
    await store.saveSettings({
      allowance_pence: allowance,
      weekly_floor_pence: floor,
      buffer_pence: poundsToPence(input.buffer) ?? 0,
      buffer_from: input.bufferFrom || null,
      first_payday: input.firstPayday || null,
      payday_rule: input.paydayRule,
    });
    return {};
  });
}

/**
 * The weekly amount alone, as the forecast suggested it ("Live on £W a week"). It is the
 * lasting amount, not this week's only, and never under the autopilot's least a week.
 */
export function setWeeklyAmount(pence: number): Promise<Result> {
  return run(async () => {
    if (!Number.isInteger(pence) || pence < 0 || pence > 100_000_00)
      throw new store.MoneyStoreError("Say the weekly amount in pounds.");
    const today = dateIn(now(), timeZone());
    const floor = parseBudget(await store.readBudget(monthStart(today), mondayOf(today))).weeklyFloorPence ?? null;
    if (floor !== null && pence < floor)
      throw new store.MoneyStoreError(
        "That's under the least a week you set. Lower it under Your plan first, if you mean to.",
      );
    await store.saveSettings({ allowance_pence: pence });
    return {};
  });
}

export type PlannedInput = { name: string; amount: string; dueOn: string; funding: string; weeks: number };

/** A purchase you plan: what, how much, when, and how it's paid for. */
export function savePlanned(input: PlannedInput): Promise<Result> {
  return run(async () => {
    const name = input.name.trim();
    if (!name) throw new store.MoneyStoreError("Say what it's for.");
    const pence = poundsToPence(input.amount);
    if (!pence) throw new store.MoneyStoreError("Say what it costs, in pounds.");
    if (!DAY.test(input.dueOn)) throw new store.MoneyStoreError("Pick the day you'll pay.");
    if (!["allowance", "spread", "safe"].includes(input.funding))
      throw new store.MoneyStoreError("Pick how to pay for it.");
    const weeks = input.funding === "spread" ? Math.min(12, Math.max(2, Math.round(input.weeks) || 2)) : 1;
    await store.savePlanned({ name: name.slice(0, 60), pence, due_on: input.dueOn, funding: input.funding, weeks });
    return {};
  });
}

/**
 * "Can I afford it?" for a cost typed on the Money page: the check Claude's money_afford
 * runs, on the budget as it stands now. It reads and writes nothing, so nothing is
 * refreshed, and it works whatever Claude's access is set to.
 */
export async function checkAfford(amount: string): Promise<Result<{ check: AffordCheck; displaces: string }>> {
  try {
    const pence = poundsToPence(amount);
    if (!pence) throw new store.MoneyStoreError("Say what it costs, in pounds.");
    const today = dateIn(now(), timeZone());
    const data = parseBudget(await store.readBudget(monthStart(today), mondayOf(today)));
    const check = affordCheck(data, today, pence);
    // Worded here, so the page's script need not carry the budget's working.
    return { check, displaces: displacesText(check) };
  } catch (e) {
    return { error: e instanceof store.MoneyStoreError ? e.message : "That didn't work. Try again." };
  }
}

export function cancelPlanned(id: number): Promise<Result> {
  return run(async () => {
    await store.cancelPlanned(id);
    return {};
  });
}

export type PayInput = {
  fromOn: string;
  /** Take-home a month, in pounds; or empty to work it out from the gross. */
  takeHome: string;
  /** Gross salary a year, in pounds. */
  gross: string;
  loans: LoanPlan[];
  pensionPercent: number;
  pensionKind: PensionKind;
};

/** A pay step: from a payday on, this take-home (typed, or worked out from the gross salary). */
export function saveIncome(input: PayInput): Promise<Result> {
  return run(async () => {
    if (!DAY.test(input.fromOn)) throw new store.MoneyStoreError("Pick the payday it starts from.");
    const gross = parsePounds(input.gross);
    const typed = parsePounds(input.takeHome);
    if (gross === undefined || typed === undefined)
      throw new store.MoneyStoreError("Amounts are in pounds, like 2280 or 2280.50.");
    const pence =
      typed ??
      (gross
        ? takeHome({
            grossYearPence: gross,
            loans: input.loans.filter((l): l is LoanPlan => l in LOANS),
            pensionPercent: Math.min(20, Math.max(0, Number(input.pensionPercent) || 0)),
            pensionKind: input.pensionKind,
          }).monthPence
        : null);
    if (!pence) throw new store.MoneyStoreError("Say the take-home a month, or the salary a year.");
    await store.saveIncome({ from_on: input.fromOn, pence, gross_year_pence: gross ?? null });
    return {};
  });
}

export function removeIncome(id: number): Promise<Result> {
  return run(async () => {
    await store.removeIncome(id);
    return {};
  });
}

export type GoalInput = {
  name: string;
  kind: "saving" | "sinking" | "debt";
  /** Pounds: the target, the cost, or what's owed. */
  amount: string;
  dueOn: string;
  repeatsYearly: boolean;
  held: "account" | "elsewhere";
  /** Pounds saved so far (not for a debt). */
  saved: string;
  /** A debt's interest, % a year, and its monthly payment in pounds. */
  apr: string;
  payment: string;
};

/** A goal: what the money is for. It goes last in the order; move it up after. */
export function saveGoal(input: GoalInput): Promise<Result> {
  return run(async () => {
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new store.MoneyStoreError("Say what it's for.");
    if (!["saving", "sinking", "debt"].includes(input.kind)) throw new store.MoneyStoreError("Pick what kind of goal.");
    const amount = poundsToPence(input.amount);
    if (!amount) throw new store.MoneyStoreError(input.kind === "debt" ? "Say what's owed." : "Say how much it needs.");
    if (input.dueOn && !DAY.test(input.dueOn)) throw new store.MoneyStoreError("Dates look like 2027-01-29.");
    const debt = input.kind === "debt";
    const apr = input.apr.trim() ? Number(input.apr) : null;
    if (apr !== null && !(apr >= 0 && apr <= 100))
      throw new store.MoneyStoreError("Interest is a % a year, like 19.9.");
    await store.saveGoal({
      name,
      kind: input.kind,
      target_pence: debt ? null : amount,
      due_on: input.dueOn || null,
      repeats_yearly: input.kind === "sinking" && input.repeatsYearly,
      held: debt ? "elsewhere" : input.held === "elsewhere" ? "elsewhere" : "account",
      saved_pence: debt ? amount : (poundsToPence(input.saved) ?? 0),
      apr_bp: debt && apr !== null ? Math.round(apr * 100) : null,
      payment_pence: debt ? poundsToPence(input.payment) : null,
    });
    return {};
  });
}

export function removeGoal(id: number): Promise<Result> {
  return run(async () => {
    await store.removeGoal(id);
    return {};
  });
}

export function moveGoal(id: number, step: -1 | 1): Promise<Result> {
  return run(async () => {
    await store.moveGoal(id, step);
    return {};
  });
}

/** Adds the goals Money suggests from what it knows (an emergency fund, money put by for yearly bills). */
export function addSuggestedGoals(): Promise<Result<{ added: number }>> {
  return run(async () => {
    const today = dateIn(now(), timeZone());
    const data = parseBudget(await store.readBudget(monthStart(today), mondayOf(today)));
    const suggested = suggestGoals(data, today);
    for (const g of suggested)
      await store.saveGoal({
        name: g.name,
        kind: g.kind,
        target_pence: g.targetPence,
        due_on: g.dueOn,
        repeats_yearly: g.repeatsYearly,
        held: g.held,
        merchant_key: g.merchantKey,
      });
    return { added: suggested.length };
  });
}

/** What Claude may do with Money: off, summary, plan or setup. Only ever set here, in the app. */
export function setClaudeAccess(level: "off" | "summary" | "plan" | "setup"): Promise<Result> {
  return run(async () => {
    await store.setClaudeAccess(level);
    return {};
  });
}
