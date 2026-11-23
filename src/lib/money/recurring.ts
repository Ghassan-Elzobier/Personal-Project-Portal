// Bills Money finds by itself: regular payments in the history, found by merchant and a
// steady gap between payments (weekly, monthly or yearly). Pure, so it is tested; the
// engine (engine.ts) runs it after each sync and adopts the bills it is sure of, and
// the budget uses each bill's real day to know what is still to pay before payday.
//
// A merchant's payments are tried as one bill first. When that fails (one merchant
// taking several subscriptions, or a subscription among one-off buys), payments of a
// similar amount are tried as a bill of their own, told apart by that amount.

import { addDays } from "../dates/week.ts";

export type Cadence = "weekly" | "monthly" | "yearly";

/** Money out to a merchant: pence is positive here. */
export type Payment = { madeOn: string; pence: number; merchantKey: string; name: string; categoryId: number | null };

export type Found = {
  /** The merchant key, plus "~pence" for a bill told apart by its amount. */
  ident: string;
  merchantKey: string;
  bandPence: number | null;
  name: string;
  cadence: Cadence;
  /** A day the bill falls on: its day of the month (monthly), weekday (weekly) or day of the year (yearly). */
  anchorOn: string;
  expectedPence: number;
  variable: boolean;
  categoryId: number | null;
  lastPaidOn: string;
  count: number;
  /** Seen enough times on time, and paid lately, to adopt without asking. */
  confident: boolean;
  /** The latest payment went up from a steady amount: a price rise. */
  rise: { from: number; to: number } | null;
};

export type Bill = {
  id: number;
  ident: string;
  merchantKey: string;
  bandPence: number | null;
  /** Null when the reader isn't the owner (Claude sees bills by category). */
  name: string | null;
  cadence: Cadence;
  anchorOn: string;
  expectedPence: number;
  variable: boolean;
  category: string | null;
  status: "active" | "ignored" | "ended";
  addedBy: "engine" | "owner" | "claude";
  createdAt: string;
  lastPaidOn: string | null;
  lastPence: number | null;
  /** The owner's last answer to "do you still want this?", and its day (subscriptions.ts). */
  reviewedOn?: string | null;
  verdict?: "keep" | "cancel" | null;
};

/** The gaps between payments that count as each cadence, in days. */
const GAP: Record<Cadence, [number, number]> = { weekly: [6, 8], monthly: [26, 35], yearly: [350, 380] };
/** A cycle's length in days, for "paid lately" and "ended". */
export const CYCLE_DAYS: Record<Cadence, number> = { weekly: 7, monthly: 30.4, yearly: 365 };
/** How many payments a cadence needs before it is a bill, and how many recent ones are looked at. */
const MIN: Record<Cadence, number> = { weekly: 4, monthly: 3, yearly: 2 };
const RECENT: Record<Cadence, number> = { weekly: 8, monthly: 12, yearly: 3 };
/** Days a bill may be late before it counts as missed. */
export const GRACE: Record<Cadence, number> = { weekly: 2, monthly: 5, yearly: 14 };

const dayMs = 86_400_000;
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/** The middle value (the mean of the middle two), in whole pence. */
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const within = (x: number, of: number, share: number) => Math.abs(x - of) <= of * share;

function lastDayOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
/** A monthly bill's day in a month: its day of the month, or the month's last day. */
export function inMonth(month: string, dom: number): string {
  return `${month}-${String(Math.min(dom, lastDayOf(month))).padStart(2, "0")}`;
}
function inYear(year: number, anchor: string): string {
  const month = `${year}-${anchor.slice(5, 7)}`;
  return inMonth(month, Number(anchor.slice(8, 10)));
}

/** The most common value, the latest winning a tie. */
function mode<T>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = xs[xs.length - 1];
  for (const x of xs) if ((counts.get(x) ?? 0) > (counts.get(best) ?? 0)) best = x;
  return best;
}

type Day = { on: string; pence: number; name: string; categoryId: number | null };

/** Payments on the same day to the same bill count as one. */
function byDay(ps: Payment[]): Day[] {
  const days = new Map<string, Day>();
  for (const p of [...ps].sort((a, b) => a.madeOn.localeCompare(b.madeOn))) {
    const d = days.get(p.madeOn);
    if (d) d.pence += p.pence;
    else days.set(p.madeOn, { on: p.madeOn, pence: p.pence, name: p.name, categoryId: p.categoryId });
  }
  return [...days.values()];
}

function regular(days: Day[], cadence: Cadence): boolean {
  if (days.length < MIN[cadence]) return false;
  const [lo, hi] = GAP[cadence];
  let ok = 0;
  for (let i = 1; i < days.length; i++) {
    const g = daysBetween(days[i - 1].on, days[i].on);
    if (g >= lo && g <= hi) ok++;
  }
  return ok / (days.length - 1) >= 0.75;
}

function tryBill(merchantKey: string, ps: Payment[], bandPence: number | null, today: string): Found | null {
  const all = byDay(ps);
  for (const cadence of ["monthly", "weekly", "yearly"] as Cadence[]) {
    const days = all.slice(-RECENT[cadence]);
    if (!regular(days, cadence)) continue;
    const amounts = days.map((d) => d.pence);
    const last3 = amounts.slice(-3);
    const m3 = median(last3);
    const fixed = last3.every((a) => within(a, m3, 0.1));
    // A weekly or yearly bill has a steady amount; otherwise it's a weekly shop or a coincidence.
    if (cadence !== "monthly" && !fixed) continue;
    const last = days[days.length - 1];
    const dom = mode(days.slice(-3).map((d) => Number(d.on.slice(8, 10))));
    const anchorOn = cadence === "monthly" ? inMonth(last.on.slice(0, 7), dom) : last.on;
    const before = amounts.slice(-3, -1);
    const steady = before.length === 2 && within(before[0], before[1], 0.03);
    const prev = before[before.length - 1];
    const rise = steady && last.pence > prev * 1.05 && last.pence - prev >= 100 ? { from: prev, to: last.pence } : null;
    const categories = days.map((d) => d.categoryId).filter((c): c is number => c !== null);
    return {
      ident: bandPence === null ? merchantKey : `${merchantKey}~${bandPence}`,
      merchantKey,
      bandPence,
      name: last.name.trim().slice(0, 60) || merchantKey,
      cadence,
      anchorOn,
      expectedPence: fixed ? last.pence : Math.max(...last3),
      variable: !fixed,
      categoryId: categories.length ? mode(categories) : null,
      lastPaidOn: last.on,
      count: days.length,
      confident: daysBetween(last.on, today) <= CYCLE_DAYS[cadence] * 1.5,
      rise,
    };
  }
  return null;
}

/** Payments of a similar amount (within 15% of the group's median), largest groups first. */
function clusters(ps: Payment[]): Payment[][] {
  const sorted = [...ps].sort((a, b) => a.pence - b.pence);
  const out: Payment[][] = [];
  for (const p of sorted) {
    const c = out[out.length - 1];
    if (c && within(p.pence, median(c.map((x) => x.pence)), 0.15)) c.push(p);
    else out.push([p]);
  }
  return out.filter((c) => c.length >= 2).sort((a, b) => b.length - a.length);
}

/** The bills in a history of money out: each merchant as one bill, or split by amount when that fails. */
export function findBills(payments: Payment[], today: string): Found[] {
  const groups = new Map<string, Payment[]>();
  for (const p of payments) {
    if (!p.merchantKey || p.pence <= 0) continue;
    groups.set(p.merchantKey, [...(groups.get(p.merchantKey) ?? []), p]);
  }
  const found: Found[] = [];
  for (const [key, ps] of groups) {
    const whole = tryBill(key, ps, null, today);
    if (whole) {
      found.push(whole);
      continue;
    }
    for (const c of clusters(ps)) {
      const f = tryBill(key, c, median(c.map((p) => p.pence)), today);
      if (f) found.push(f);
    }
  }
  return found.sort((a, b) => a.ident.localeCompare(b.ident));
}

type Schedule = Pick<Bill, "cadence" | "anchorOn" | "lastPaidOn">;

/** The day of the occurrence nearest a payment: the one that payment paid. */
function paidOccurrence(b: Schedule, paidOn: string): string {
  if (b.cadence === "weekly") return paidOn;
  if (b.cadence === "monthly") {
    const dom = Number(b.anchorOn.slice(8, 10));
    const month = paidOn.slice(0, 7);
    const options = [-1, 0, 1].map((n) => inMonth(shiftMonth(month, n), dom));
    return options.reduce((best, d) =>
      Math.abs(daysBetween(paidOn, d)) < Math.abs(daysBetween(paidOn, best)) ? d : best,
    );
  }
  const year = Number(paidOn.slice(0, 4));
  const options = [year - 1, year, year + 1].map((y) => inYear(y, b.anchorOn));
  return options.reduce((best, d) =>
    Math.abs(daysBetween(paidOn, d)) < Math.abs(daysBetween(paidOn, best)) ? d : best,
  );
}

/** The occurrence after one. */
export function following(b: Pick<Bill, "cadence" | "anchorOn">, day: string): string {
  if (b.cadence === "weekly") return addDays(day, 7);
  if (b.cadence === "monthly") return inMonth(shiftMonth(day.slice(0, 7), 1), Number(b.anchorOn.slice(8, 10)));
  return inYear(Number(day.slice(0, 4)) + 1, b.anchorOn);
}

/**
 * The next occurrence not paid yet: the one after the latest payment's, or for a bill
 * never paid, the first from its anchor day on or after today. It can be in the past
 * when a bill is late.
 */
export function nextDue(b: Schedule, today: string): string {
  if (b.lastPaidOn) return following(b, paidOccurrence(b, b.lastPaidOn));
  let d = b.anchorOn;
  while (d < today) d = following(b, d);
  return d;
}

/** The unpaid occurrences up to and including a day (a late one counts as still to pay). */
export function dueUntil(b: Schedule, today: string, until: string): string[] {
  const out: string[] = [];
  for (let d = nextDue(b, today); d <= until && out.length < 60; d = following(b, d)) out.push(d);
  return out;
}

/** A bill's days from `from` up to (not including) `to`, by its schedule alone: for a pay cycle ahead. */
export function occurrencesIn(b: Pick<Bill, "cadence" | "anchorOn">, from: string, to: string): string[] {
  let d = b.anchorOn;
  for (let i = 0; d < from && i < 2000; i++) d = following(b, d);
  const out: string[] = [];
  for (; d < to && out.length < 60; d = following(b, d)) out.push(d);
  return out;
}

/** What a bill costs in a year. */
export function yearlyPence(b: Pick<Bill, "cadence" | "expectedPence">): number {
  return b.expectedPence * (b.cadence === "weekly" ? 52 : b.cadence === "monthly" ? 12 : 1);
}

/** A bill not paid for two and a half cycles has ended (a cancelled subscription). */
export function hasEnded(b: Schedule, today: string): boolean {
  return b.lastPaidOn !== null && daysBetween(b.lastPaidOn, today) > CYCLE_DAYS[b.cadence] * 2.5;
}

export type Adoption = {
  ident: string;
  merchant_key: string;
  band_pence: number | null;
  name: string;
  cadence: Cadence;
  anchor_on: string;
  expected_pence: number;
  variable: boolean;
  category_id: number | null;
  status: "active" | "ended";
};

/**
 * What to write back: each confident bill found (never one the owner ignored), and
 * each active bill that has stopped (ended). A bill that starts again is found again
 * and becomes active.
 */
export function adoptions(found: Found[], bills: Bill[], today: string): Adoption[] {
  const held = new Map(bills.map((b) => [b.ident, b]));
  const rows: Adoption[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    if (!f.confident || held.get(f.ident)?.status === "ignored") continue;
    seen.add(f.ident);
    rows.push({
      ident: f.ident,
      merchant_key: f.merchantKey,
      band_pence: f.bandPence,
      name: f.name,
      cadence: f.cadence,
      anchor_on: f.anchorOn,
      expected_pence: f.expectedPence,
      variable: f.variable,
      category_id: f.categoryId,
      status: "active",
    });
  }
  for (const b of bills) {
    if (b.status !== "active" || seen.has(b.ident) || !hasEnded(b, today)) continue;
    rows.push({
      ident: b.ident,
      merchant_key: b.merchantKey,
      band_pence: b.bandPence,
      name: b.name ?? b.merchantKey,
      cadence: b.cadence,
      anchor_on: b.anchorOn,
      expected_pence: b.expectedPence,
      variable: b.variable,
      category_id: null,
      status: "ended",
    });
  }
  return rows;
}

export type BillAlert = {
  kind: "price-rise" | "missed-bill";
  dedupe: string;
  ident: string;
  detail: Record<string, string | number>;
};

/**
 * Bills that need a look: a price rise paid in the last fortnight, and an active bill
 * more than a few days late (once per missed day). The database drops any for a bill
 * that isn't active.
 */
export function billAlerts(found: Found[], bills: Bill[], today: string): BillAlert[] {
  const out: BillAlert[] = [];
  for (const f of found) {
    if (f.rise && daysBetween(f.lastPaidOn, today) <= 14)
      out.push({
        kind: "price-rise",
        dedupe: `price-rise:${f.ident}:${f.lastPaidOn}`,
        ident: f.ident,
        detail: { from_pence: f.rise.from, to_pence: f.rise.to, on: f.lastPaidOn, name: f.name },
      });
  }
  for (const b of bills) {
    if (b.status !== "active" || !b.lastPaidOn || hasEnded(b, today)) continue;
    const due = nextDue(b, today);
    if (daysBetween(due, today) > GRACE[b.cadence])
      out.push({
        kind: "missed-bill",
        dedupe: `missed-bill:${b.ident}:${due}`,
        ident: b.ident,
        detail: { due, pence: b.expectedPence, name: b.name ?? b.merchantKey },
      });
  }
  return out;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const CADENCES: Cadence[] = ["weekly", "monthly", "yearly"];

/** The payments the engine reads (money_engine_read), money out as positive pence. */
export function parsePayments(raw: unknown): Payment[] {
  return (Array.isArray(raw) ? (raw as Row[]) : [])
    .map((r) => ({
      madeOn: str(r.made_on) ?? "",
      pence: num(r.pence) ?? 0,
      merchantKey: str(r.merchant_key) ?? "",
      name: str(r.name) ?? "",
      categoryId: num(r.category_id),
    }))
    .filter((p) => p.madeOn !== "" && p.merchantKey !== "" && p.pence > 0);
}

/** A bill as the database returns it. */
export function parseBill(r: Row): Bill {
  const status = str(r.status);
  const by = str(r.added_by);
  return {
    id: num(r.id) ?? 0,
    ident: str(r.ident) ?? "",
    merchantKey: str(r.merchant_key) ?? str(r.ident)?.split("~")[0] ?? "",
    bandPence: num(r.band_pence),
    name: str(r.name),
    cadence: CADENCES.find((c) => c === r.cadence) ?? "monthly",
    anchorOn: str(r.anchor_on) ?? "",
    expectedPence: num(r.expected_pence) ?? 0,
    variable: r.variable === true,
    category: str(r.category),
    status: status === "ignored" || status === "ended" ? status : "active",
    addedBy: by === "owner" || by === "claude" ? by : "engine",
    createdAt: str(r.created_at) ?? "",
    lastPaidOn: str(r.last_paid_on),
    lastPence: num(r.last_pence),
    // Only when the database sends them (the owner's reads, from part 10 on).
    ...("reviewed_on" in r && { reviewedOn: str(r.reviewed_on) }),
    ...("verdict" in r && { verdict: r.verdict === "keep" || r.verdict === "cancel" ? r.verdict : null }),
  };
}
