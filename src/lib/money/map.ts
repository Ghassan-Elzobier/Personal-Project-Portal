// Lunch Flow's answers, turned into what the portal keeps. Pure, so it is tested.
//
// The bank's own names for an account carry the sort code and account number, and
// its records carry the full IBAN and the holder's name. None of that is kept: an
// account is named by its type, with the last 4 digits of its number to tell two
// apart. Amounts become exact pence, never floats.

/** A sync or connect that failed, as a code only: production errors become public issues. */
export class BankError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`BANK_SYNC:${code}`);
    this.name = "BankError";
    this.code = code;
  }
}

/** The fields of a Lunch Flow account the portal reads. */
export type LunchFlowAccount = {
  id: number | string;
  status?: string;
  raw?: { gocardless?: { iban?: string; scan?: string; cashAccountType?: string; currency?: string } };
};

export type AccountKind = "current" | "savings" | "credit-card" | "other";

/** An account to pick when connecting, with nothing that identifies it beyond 4 digits. */
export type AccountChoice = { uid: string; name: string; kind: AccountKind; last4: string | null; currency: string };

const KINDS: Record<string, AccountKind> = { CACC: "current", SVGS: "savings", CARD: "credit-card" };
export const KIND_NAMES: Record<AccountKind, string> = {
  current: "Current account",
  savings: "Savings account",
  "credit-card": "Credit card",
  other: "Account",
};

export function accountChoice(a: LunchFlowAccount): AccountChoice {
  const g = a.raw?.gocardless ?? {};
  const digits = (g.iban ?? g.scan ?? "").replace(/\D/g, "");
  const kind = KINDS[g.cashAccountType ?? ""] ?? (g.cashAccountType ? "other" : "current");
  return {
    uid: String(a.id),
    name: KIND_NAMES[kind],
    kind,
    last4: digits.length >= 4 ? digits.slice(-4) : null,
    currency: /^[A-Z]{3}$/.test(g.currency ?? "") ? g.currency! : "GBP",
  };
}

/** The accounts a key can see, from `GET /accounts`, without the ones Lunch Flow has stopped. */
export function accountChoices(json: unknown): AccountChoice[] {
  const list = Array.isArray(json) ? json : ((json as { accounts?: unknown })?.accounts ?? []);
  if (!Array.isArray(list)) throw new BankError("BAD_ACCOUNTS");
  return list
    .filter((a): a is LunchFlowAccount => Boolean(a) && (typeof a.id === "number" || typeof a.id === "string"))
    .filter((a) => !a.status || a.status.toUpperCase() === "ACTIVE")
    .map(accountChoice);
}

/**
 * An amount as exact pence. Lunch Flow sends numbers (and the raw bank record
 * strings): either must have at most 2 decimals, or it is refused rather than rounded.
 */
export function toPence(v: unknown): number {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new BankError("AMOUNT");
  const pence = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence >= 1e11) throw new BankError("AMOUNT");
  return m[1] && pence ? -pence : pence;
}

/** `GET /accounts/:id/balance` → the balance to store. Lunch Flow gives one figure, with no date. */
export function balanceOf(json: unknown): { kind: "available"; pence: number } {
  const b = (json as { balance?: { amount?: unknown } } | null)?.balance;
  if (!b || b.amount === undefined || b.amount === null) throw new BankError("BAD_BALANCE");
  return { kind: "available", pence: toPence(b.amount) };
}
