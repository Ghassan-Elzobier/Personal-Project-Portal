// What the Money page shows, from what the database holds: the connection, its
// accounts with their latest balance, and how the syncs are going, in words. Pure,
// so it is tested; load.ts reads the data and calls it.

import type { AccountKind } from "./map";

export type MoneyAccount = {
  id: number;
  name: string;
  kind: AccountKind;
  last4: string | null;
  currency: string;
  inSafe: boolean;
  balance: { pence: number; at: string } | null;
};

export type MoneyState = {
  claudeAccess: "off" | "summary" | "plan" | "setup";
  connection: { status: "active" | "stale" | "off"; lastDataAt: string | null; createdAt: string } | null;
  /** The accounts in use (picked when connecting). */
  accounts: MoneyAccount[];
  lastSync: { outcome: string; errorCode: string | null; startedAt: string } | null;
  /** When a sync last finished without a problem. */
  lastOk: string | null;
  /** Failed syncs in a row since then. */
  failures: number;
  /** The scheduled sync's key, once registered, and when it last ran. */
  syncKey: { createdAt: string; lastUsedAt: string | null } | null;
  /** The first day of this month, which the category totals count from. */
  month: string | null;
  categories: Category[];
  /** This month's payments no rule or hand has sorted. */
  unsorted: number;
  rules: Rule[];
  alerts: Alert[];
};

export type CategoryKind = "income" | "bills" | "groceries" | "essentials" | "discretionary" | "savings" | "transfer";

export type Category = {
  id: number;
  key: string;
  name: string;
  kind: CategoryKind;
  /** A month's budget, when there is one. */
  budgetPence: number | null;
  /** This month so far. */
  outPence: number;
  inPence: number;
};

export type Rule = {
  id: number;
  field: "merchant" | "description";
  pattern: string;
  category: string | null;
  watch: boolean;
  /** One of the starter rules the portal ships with. */
  starter: boolean;
};

export type Alert = {
  id: number;
  kind: string;
  raisedAt: string;
  payment: { madeOn: string; pence: number; name: string } | null;
};

export type Txn = {
  id: number;
  accountId: number;
  status: "booked" | "pending";
  source: "lunchflow" | "statement";
  bookedOn: string | null;
  madeOn: string;
  pence: number;
  method: string;
  description: string;
  counterparty: string | null;
  note: string | null;
  categoryId: number | null;
  /** Who sorted it: a rule, or the owner by hand. */
  categoryBy: "rule" | "owner" | null;
};

type Row = Record<string, unknown>;
const KINDS: CategoryKind[] = ["income", "bills", "groceries", "essentials", "discretionary", "savings", "transfer"];
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function parseMoney(raw: unknown): MoneyState {
  const r = (raw ?? {}) as Row;
  const c = r.connection as Row | null;
  const s = r.settings as Row | null;
  const last = r.last_sync as Row | null;
  const access = str(s?.claude_access);
  return {
    claudeAccess: access === "off" || access === "summary" || access === "plan" ? access : "setup",
    connection: c
      ? {
          status: c.status === "stale" || c.status === "off" ? c.status : "active",
          lastDataAt: str(c.last_data_at),
          createdAt: str(c.created_at) ?? "",
        }
      : null,
    accounts: (Array.isArray(r.accounts) ? (r.accounts as Row[]) : [])
      .filter((a) => !a.hidden)
      .map((a) => {
        const b = a.balance as Row | null;
        return {
          id: Number(a.id),
          name: str(a.name) ?? "Account",
          kind: (str(a.kind) ?? "other") as AccountKind,
          last4: str(a.last4),
          currency: str(a.currency) ?? "GBP",
          inSafe: a.in_safe !== false,
          balance: b ? { pence: Number(b.pence), at: str(b.at) ?? "" } : null,
        };
      }),
    lastSync: last
      ? { outcome: str(last.outcome) ?? "", errorCode: str(last.error_code), startedAt: str(last.started_at) ?? "" }
      : null,
    lastOk: str(r.last_ok),
    failures: Number(r.failures ?? 0),
    syncKey: r.sync_key
      ? { createdAt: str((r.sync_key as Row).created_at) ?? "", lastUsedAt: str((r.sync_key as Row).last_used_at) }
      : null,
    month: str(r.month),
    categories: (Array.isArray(r.categories) ? (r.categories as Row[]) : []).map((c) => ({
      id: Number(c.id),
      key: str(c.key) ?? "",
      name: str(c.name) ?? "",
      kind: KINDS.includes(c.kind as CategoryKind) ? (c.kind as CategoryKind) : "discretionary",
      budgetPence: c.budget_pence === null || c.budget_pence === undefined ? null : Number(c.budget_pence),
      outPence: Number(c.out_pence ?? 0),
      inPence: Number(c.in_pence ?? 0),
    })),
    unsorted: Number(r.unsorted ?? 0),
    rules: (Array.isArray(r.rules) ? (r.rules as Row[]) : []).map((x) => ({
      id: Number(x.id),
      field: x.field === "description" ? "description" : "merchant",
      pattern: str(x.pattern) ?? "",
      category: str(x.category),
      watch: x.watch === true,
      starter: Number(x.position ?? 0) >= 1000,
    })),
    alerts: (Array.isArray(r.alerts) ? (r.alerts as Row[]) : []).map((a) => {
      const p = a.payment as Row | null;
      return {
        id: Number(a.id),
        kind: str(a.kind) ?? "",
        raisedAt: str(a.raised_at) ?? "",
        payment: p ? { madeOn: str(p.made_on) ?? "", pence: Number(p.pence), name: str(p.name) ?? "" } : null,
      };
    }),
  };
}

export const KIND_NAMES: Record<CategoryKind, string> = {
  income: "Money in",
  bills: "Bills",
  groceries: "Groceries",
  essentials: "Essentials",
  discretionary: "Spending",
  savings: "Savings",
  transfer: "Transfers",
};

/**
 * This month's spending by category, the way the page shows it: categories with money
 * out or a budget, in their order, each with how much of its budget is gone. Income
 * and transfers are left out; they aren't spending.
 */
export function monthView(categories: Category[]): {
  rows: (Category & { share: number | null; over: boolean })[];
  out: number;
  budget: number;
} {
  const rows = categories
    .filter((c) => c.kind !== "income" && c.kind !== "transfer" && (c.outPence > 0 || (c.budgetPence ?? 0) > 0))
    .map((c) => ({
      ...c,
      share: c.budgetPence ? Math.min(1, c.outPence / c.budgetPence) : null,
      over: c.budgetPence !== null && c.outPence > c.budgetPence,
    }));
  return {
    rows,
    out: rows.reduce((s, c) => s + c.outPence, 0),
    budget: rows.reduce((s, c) => s + (c.budgetPence ?? 0), 0),
  };
}

export function parseTransactions(raw: unknown): Txn[] {
  return (Array.isArray(raw) ? (raw as Row[]) : []).map((t) => ({
    id: Number(t.id),
    accountId: Number(t.account_id),
    status: t.status === "pending" ? "pending" : "booked",
    source: t.source === "statement" ? "statement" : "lunchflow",
    bookedOn: str(t.booked_on),
    madeOn: str(t.made_on) ?? "",
    pence: Number(t.pence),
    method: str(t.method) ?? "other",
    description: str(t.description) ?? "",
    counterparty: str(t.counterparty),
    note: str(t.note),
    categoryId: t.category_id === null || t.category_id === undefined ? null : Number(t.category_id),
    categoryBy: t.category_by === "owner" ? "owner" : t.category_by === "rule" ? "rule" : null,
  }));
}

/** A transaction's name as you'd read it: the payee's name when the bank gives one, else its text. */
export function txnName(t: Txn): string {
  return t.counterparty || t.description;
}

/** Transactions by day, newest first, with pending ones first under "Pending". */
export function byDay(txns: Txn[]): { day: string | null; txns: Txn[]; out: number; in: number }[] {
  const groups = new Map<string | null, Txn[]>();
  for (const t of [...txns].sort((a, b) =>
    a.status === b.status ? b.madeOn.localeCompare(a.madeOn) || b.id - a.id : a.status === "pending" ? -1 : 1,
  )) {
    const key = t.status === "pending" ? null : (t.bookedOn ?? t.madeOn);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups].map(([day, list]) => ({
    day,
    txns: list,
    out: list.filter((t) => t.pence < 0).reduce((s, t) => s - t.pence, 0),
    in: list.filter((t) => t.pence > 0).reduce((s, t) => s + t.pence, 0),
  }));
}

/** "£3,185.60", and "−£42.05" for money owed. */
export function pounds(pence: number, currency = "GBP"): string {
  const text = new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Math.abs(pence) / 100);
  return pence < 0 ? `−${text}` : text;
}

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export function ago(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** What a sync's code means for you, and what to do about it. */
export function bankMessage(code: string): string {
  if (code === "NO_KEY") return "Add your Lunch Flow key in Vercel first (LUNCHFLOW_API_KEY), then redeploy.";
  if (code === "HTTP_401" || code === "HTTP_403")
    return "Lunch Flow refused the key. Check it in Lunch Flow, then put the new one in Vercel.";
  if (code === "HTTP_429") return "Lunch Flow asked to slow down. The next sync waits an hour.";
  if (code === "HTTP_404") return "Lunch Flow no longer has that account. Connect again to pick it.";
  if (code === "TIMEOUT" || code === "NETWORK" || /^HTTP_5\d\d$/.test(code))
    return "Lunch Flow didn't answer. Try again in a minute.";
  return "Lunch Flow's answer didn't make sense. Try again later.";
}

/** A line about the feed when something needs you, most urgent first; null when all is well. */
export function feedNote(s: MoneyState): { tone: "warn" | "error"; text: string } | null {
  if (!s.connection) return null;
  if (s.connection.status === "off") return { tone: "warn", text: "Disconnected. Your history is kept." };
  const code = s.lastSync?.errorCode;
  if (code === "HTTP_401" || code === "HTTP_403") return { tone: "error", text: bankMessage(code) };
  if (s.failures >= 3)
    return { tone: "error", text: `The last ${s.failures} syncs failed. The balance shown may be out of date.` };
  if (s.connection.status === "stale")
    return {
      tone: "warn",
      text: "No new bank data for 3 days. Check Lunch Flow: the bank link may need reconfirming.",
    };
  if (s.lastSync?.outcome === "rate-limited") return { tone: "warn", text: bankMessage("HTTP_429") };
  return null;
}
