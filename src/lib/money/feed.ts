// Transactions from the feed (and from statements), turned into the rows the
// database keeps. Pure, so it is tested.
//
// Each row gets a fingerprint: a hash of its day, amount and text, plus a count among
// identical rows in the same batch, so two £3.50 coffees on one day stay two rows and
// the overlap between syncs never doubles anything. Text is cleaned to a merchant key
// ("SAINSBURYS S/MKTS LONDON" becomes "sainsburys-smkts") for rules and bills later.

import { createHash } from "node:crypto";
import { addDays } from "../dates/week.ts";
import { BankError, toPence } from "./map.ts";

/** How far back the first sync reaches: Lunch Flow holds about 15 months. */
const FIRST_DAYS = 456;
/** Banks book some card payments days after the purchase, so each sync looks back this far. */
const OVERLAP_DAYS = 10;

/** The day a sync asks from, given the last day the feed booked anything. */
export function syncFrom(latest: string | null, today: string): string {
  return latest ? addDays(latest, -OVERLAP_DAYS) : addDays(today, -FIRST_DAYS);
}

/**
 * The request for one account's transactions from a day on. Lunch Flow leaves pending
 * payments out unless asked (`include_pending` is false by default), and the bank's raw
 * record carries the exact amounts.
 */
export function transactionsPath(uid: string, from: string): string {
  const query = new URLSearchParams({ from, include_pending: "true", include_raw: "true" });
  return `/accounts/${encodeURIComponent(uid)}/transactions?${query}`;
}

export type Method = "card" | "direct-debit" | "standing-order" | "transfer" | "cash" | "other";

export type TxnRow = {
  ref: string | null;
  fingerprint: string;
  booked_on: string | null;
  value_on: string | null;
  made_on: string;
  pence: number;
  method: Method;
  description: string;
  counterparty: string | null;
  merchant_key: string | null;
};

type GoCardless = {
  transactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount?: { amount?: string };
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  creditorName?: string;
  debtorName?: string;
  proprietaryBankTransactionCode?: string;
};

type LunchFlowTxn = {
  id?: string | number;
  amount?: number | string;
  date?: string;
  merchant?: string;
  description?: string;
  isPending?: boolean;
  raw?: { gocardless?: GoCardless };
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** Spaces tidied and the length capped. */
export function clean(text: unknown, max = 300): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A short stable key for a merchant: its first two words, letters only. */
export function merchantKey(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = text
    .toLowerCase()
    .replace(/[’'./]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && /[a-z]/.test(w) && !/\d/.test(w));
  return words.slice(0, 2).join("-").slice(0, 60) || null;
}

/** The kind of payment, from the bank's code ("PaymentType: VP"). Unknown codes are "other". */
export function methodOf(code: string | undefined): Method {
  const c = (code ?? "")
    .replace(/^PaymentType:\s*/i, "")
    .trim()
    .toUpperCase();
  if (c === "VP") return "card";
  if (c === "VW") return "cash";
  if (/^D\d$/.test(c)) return "direct-debit";
  if (/^(W[A-Z]|L[A-Z]|CV)$/.test(c)) return "transfer";
  return "other";
}

/** The fingerprint for a row: its day, pence and text, and how many identical rows came before it. */
export function fingerprint(on: string, pence: number, description: string, n: number): string {
  return createHash("sha256").update(`${on}|${pence}|${description}|${n}`).digest("hex");
}

/** Gives each row its fingerprint, counting identical rows within the batch. */
export function withFingerprints<
  T extends { booked_on: string | null; made_on: string; pence: number; description: string },
>(rows: T[]): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.booked_on ?? r.made_on}|${r.pence}|${r.description}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...r, fingerprint: fingerprint(r.booked_on ?? r.made_on, r.pence, r.description, n) };
  });
}

/**
 * `GET /accounts/:id/transactions` → booked and pending rows. The amount comes from the
 * bank's own string when there is one (exact pence), and a zero amount is left out.
 */
export function feedRows(json: unknown, today: string): { booked: TxnRow[]; pending: TxnRow[] } {
  const list = Array.isArray(json) ? json : (json as { transactions?: unknown } | null)?.transactions;
  if (!Array.isArray(list)) throw new BankError("BAD_TRANSACTIONS");
  const rows = (list as LunchFlowTxn[])
    .map((t) => {
      const g = t.raw?.gocardless ?? {};
      const pence = toPence(g.transactionAmount?.amount ?? t.amount);
      const pending = Boolean(t.isPending);
      const on = day(g.bookingDate) ?? day(t.date) ?? today;
      const description =
        clean([g.remittanceInformationUnstructured, ...(g.remittanceInformationUnstructuredArray ?? [])].join(" ")) ||
        clean(t.description) ||
        clean(t.merchant) ||
        "Payment";
      const counterparty = clean(pence < 0 ? g.creditorName : g.debtorName, 140) || null;
      const ref = !pending ? clean(g.transactionId ?? (t.id === undefined ? "" : String(t.id)), 200) || null : null;
      return {
        pending,
        ref,
        booked_on: pending ? null : on,
        value_on: day(g.valueDate),
        made_on: day(t.date) ?? on,
        pence,
        method: methodOf(g.proprietaryBankTransactionCode),
        description,
        counterparty,
        merchant_key: merchantKey(clean(t.merchant) || counterparty || description),
      };
    })
    .filter((r) => r.pence !== 0);
  const keep = (r: (typeof rows)[number] & { fingerprint: string }): TxnRow => ({
    ref: r.ref,
    fingerprint: r.fingerprint,
    booked_on: r.booked_on,
    value_on: r.value_on,
    made_on: r.made_on,
    pence: r.pence,
    method: r.method,
    description: r.description,
    counterparty: r.counterparty,
    merchant_key: r.merchant_key,
  });
  return {
    booked: withFingerprints(rows.filter((r) => !r.pending)).map(keep),
    pending: withFingerprints(rows.filter((r) => r.pending)).map(keep),
  };
}
