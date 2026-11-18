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
};

type Row = Record<string, unknown>;
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
  };
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
