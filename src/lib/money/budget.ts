// The weekly amount and safe-to-spend, from the balance, the plan and this cycle's
// payments. Pure, so it is tested with a pinned clock.
//
// The pay cycle runs to the next payday: the last working day of the month (or a set
// day), never before the first payday you set, moved back past weekends and bank
// holidays in England and Wales. Before payday, the money that is spoken for comes off
// the balance first:
//
//   safe-to-spend = balance − fixed costs still to pay before payday − the buffer
//
// Fixed costs are the categories of kind bills or savings with a monthly budget: for
// each month the window touches, its budget, less what has been paid since the first
// of this month. What's left is spread over the weeks to payday, and set against the
// weekly amount you planned. The weekly amount counts what you spend that isn't fixed
// (groceries, essentials, spending, and anything not sorted yet), Monday to Sunday;
// overspending last week comes off this week, so the month still balances.

import { addDays, weekdayIndex } from "../dates/week.ts";
import { dueUntil, parseBill, type Bill } from "./recurring.ts";

/** Bank holidays in England and Wales (GOV.UK), for moving a payday off them. */
export const BANK_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-04",
  "2026-05-25",
  "2026-08-31",
  "2026-12-25",
  "2026-12-28",
  "2027-01-01",
  "2027-03-26",
  "2027-03-29",
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27",
  "2027-12-28",
  "2028-01-03",
  "2028-04-14",
  "2028-04-17",
  "2028-05-01",
  "2028-05-29",
  "2028-08-28",
  "2028-12-25",
  "2028-12-26",
]);

const working = (d: string) => weekdayIndex(d) < 5 && !BANK_HOLIDAYS.has(d);

/** The last day of a month ("2026-12" → "2026-12-31"). */
function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The payday in a month by the rule: the last working day, or a set day moved back to a working one. */
export function paydayIn(month: string, rule: string): string {
  const day = /^day-(\d{1,2})$/.exec(rule);
  let d = lastDay(month);
  if (day) d = `${month}-${String(Math.min(Number(day[1]), Number(d.slice(8)))).padStart(2, "0")}`;
  while (!working(d)) d = addDays(d, -1);
  return d;
}

const monthOf = (d: string) => d.slice(0, 7);
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The next payday after today, no earlier than the first payday you set. */
export function nextPayday(today: string, rule: string, firstPayday: string | null): string {
  let month = monthOf(today);
  let d = paydayIn(month, rule);
  while (d <= today || (firstPayday !== null && d < firstPayday)) {
    month = nextMonth(month);
    d = paydayIn(month, rule);
  }
  return d;
}

/** The Monday of a day's week. */
export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** How many months the window from today to payday touches, this one included. */
export function monthsTo(today: string, payday: string): number {
  const [y1, m1] = today.split("-").map(Number);
  const [y2, m2] = payday.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export type BudgetCategory = {
  key: string;
  name: string;
  kind: string;
  budgetPence: number | null;
  /** Paid out since the first of this month. */
  paidMonth: number;
  /** Spent this week (Monday on) and last week. */
  spentWeek: number;
  spentLastWeek: number;
};

export type BudgetData = {
  balancePence: number | null;
  /** The weekly amount you set, or null to work it out from the monthly plan. */
  allowancePence: number | null;
  bufferPence: number;
  bufferFrom: string | null;
  paydayRule: string;
  firstPayday: string | null;
  categories: BudgetCategory[];
  /** Spending not sorted into any category yet: this week and last. */
  unsortedWeek: number;
  unsortedLastWeek: number;
  /** Planned purchases not paid yet: one-offs due before payday, and spread ones by the week. */
  planned?: Planned[];
  /** Regular payments Money found (recurring.ts): the active ones count on their own days. */
  bills?: Bill[];
};

export type Planned = {
  id?: number;
  name: string;
  pence: number;
  dueOn: string;
  /** "allowance": from that week's amount; "spread": a share over `weeks` weeks; anything else: from what's safe before payday. */
  funding: string;
  weeks: number;
  addedBy?: "owner" | "claude";
};

export type AffordOption = {
  funding: "allowance" | "spread" | "safe";
  weeks: number;
  /** What it does, in a sentence. */
  text: string;
};

export type Afford = {
  verdict: "fits" | "tight" | "out" | "unknown";
  /** Why, in a sentence. */
  reason: string;
  /** Ways to pay for it, best first, each with its effect. */
  options: AffordOption[];
  /** With a weekly saving (a repair that replaces the bus), how many weeks until it has paid for itself. */
  paysBackWeeks: number | null;
};

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/**
 * "Can I afford it?" for a cost of `pence`, read-only. Fits: this week's amount covers
 * it, or what's safe to spend does without going under the weekly amount. Tight: it
 * fits only by moving something (spreading it, or less a week to payday). Out of reach:
 * it would take you past what's safe to spend before payday, into the buffer or bills.
 */
export function afford(data: BudgetData, today: string, pence: number, savesPerWeek = 0): Afford {
  const v = budgetView(data, today);
  const paysBackWeeks = savesPerWeek > 0 ? Math.ceil(pence / savesPerWeek) : null;
  if (v.safe === null) {
    return {
      verdict: "unknown",
      reason: "Money has no balance yet: connect the bank first.",
      options: [],
      paysBackWeeks,
    };
  }
  const allowance = v.week.allowance;
  const left = v.week.left;
  const options: AffordOption[] = [];
  if (left !== null && left >= pence)
    options.push({
      funding: "allowance",
      weeks: 1,
      text: `From this week's amount: ${gbp(left - pence)} left this week after.`,
    });
  if (allowance !== null && v.safe >= pence)
    for (const weeks of [2, 3, 4]) {
      const share = Math.ceil(pence / weeks);
      if (share < allowance && (left ?? 0) >= share)
        options.push({
          funding: "spread",
          weeks,
          text: `${gbp(share)} a week for ${weeks} weeks: your weekly amount goes from ${gbp(allowance)} to ${gbp(allowance - share)}.`,
        });
    }
  const after = Math.floor((v.safe - pence) / Math.max(1, v.daysToPayday / 7));
  if (v.safe >= pence)
    options.push({
      funding: "safe",
      weeks: 1,
      text:
        `From what's safe to spend before payday: ${gbp(Math.max(0, after))} a week to payday instead of ${gbp(Math.max(0, v.perWeek ?? 0))}` +
        (allowance !== null && after < allowance ? `, under your ${gbp(allowance)} a week.` : "."),
    });
  if (v.safe < pence) {
    return {
      verdict: "out",
      reason: `It would take you ${gbp(pence - v.safe)} past what's safe to spend before payday on ${v.payday}${v.buffer > 0 ? ", into your buffer" : ""}. After payday, it can be planned then.`,
      options: [],
      paysBackWeeks,
    };
  }
  const fits = options.some((o) => o.funding === "allowance") || (allowance !== null && after >= allowance);
  return {
    verdict: fits ? "fits" : "tight",
    reason: fits
      ? "It fits without changing your weekly amount."
      : "It fits, but only by moving something: spread it, or have less a week until payday.",
    options,
    paysBackWeeks,
  };
}

const FIXED = new Set(["bills", "savings"]);
const FLEXIBLE = new Set(["groceries", "essentials", "discretionary"]);

export type BudgetView = {
  payday: string;
  daysToPayday: number;
  weeksToPayday: number;
  balance: number | null;
  /** Each fixed cost still to pay before payday: a bill with its next day, or a category's monthly estimate. */
  stillToPay: { key: string; name: string; pence: number; on?: string }[];
  buffer: number;
  /** One-off planned purchases due before payday. */
  plannedBefore: number;
  safe: number | null;
  perWeek: number | null;
  week: { allowance: number | null; carry: number; spread: number; spent: number; left: number | null };
  /** Whether what's left covers the weekly amount every week to payday. */
  onTrack: boolean | null;
};

/** The weekly amount from the plan when you haven't set one: the flexible budgets, a month's worth spread over the year's weeks. */
export function allowanceFrom(data: BudgetData): number | null {
  if (data.allowancePence !== null) return data.allowancePence;
  const monthly = data.categories.filter((c) => FLEXIBLE.has(c.kind)).reduce((s, c) => s + (c.budgetPence ?? 0), 0);
  return monthly > 0 ? Math.round((monthly * 12) / 52 / 100) * 100 : null;
}

export function budgetView(data: BudgetData, today: string): BudgetView {
  const payday = nextPayday(today, data.paydayRule, data.firstPayday);
  const days = Math.round((Date.parse(`${payday}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const weeks = Math.max(1, days / 7);
  const months = monthsTo(today, payday);
  // A bill Money found counts on each of its days up to payday. A category with such a
  // bill leaves its monthly estimate out, so nothing is counted twice; the others count
  // their budget for each month the window touches, less what's gone out this month.
  const bills = (data.bills ?? []).filter((b) => b.status === "active");
  const billed = new Set(bills.map((b) => b.category).filter((c) => c !== null));
  const named = new Map(data.categories.map((c) => [c.key, c.name]));
  const fromBills = bills
    .map((b) => {
      const due = dueUntil(b, today, payday);
      return {
        key: `bill-${b.id}`,
        name: b.name ?? (b.category ? named.get(b.category) : undefined) ?? "A bill",
        pence: due.length * b.expectedPence,
        on: due[0],
      };
    })
    .filter((c) => c.pence > 0)
    .sort((a, b) => a.on.localeCompare(b.on));
  const stillToPay = [
    ...fromBills,
    ...data.categories
      .filter((c) => FIXED.has(c.kind) && (c.budgetPence ?? 0) > 0 && !billed.has(c.key))
      .map((c) => ({ key: c.key, name: c.name, pence: Math.max(0, c.budgetPence! * months - c.paidMonth) }))
      .filter((c) => c.pence > 0),
  ];
  const buffer = !data.bufferFrom || data.bufferFrom <= today ? data.bufferPence : 0;
  // Planned purchases: a one-off due before payday is spoken for now; one paid from the
  // weekly amount also comes off its week; a spread one takes a share off each of its weeks.
  const planned = data.planned ?? [];
  const week = mondayOf(today);
  const plannedBefore = planned
    .filter((p) => p.funding !== "spread" && p.dueOn <= payday)
    .reduce((s, p) => s + p.pence, 0);
  const spread = planned.reduce((s, p) => {
    const from = mondayOf(p.dueOn);
    if (p.funding === "allowance" && from === week) return s + p.pence;
    if (p.funding === "spread" && week >= from && week <= addDays(from, 7 * (Math.max(1, p.weeks) - 1)))
      return s + Math.ceil(p.pence / Math.max(1, p.weeks));
    return s;
  }, 0);
  const safe =
    data.balancePence === null
      ? null
      : data.balancePence - stillToPay.reduce((s, c) => s + c.pence, 0) - buffer - plannedBefore;
  const allowance = allowanceFrom(data);
  const flexible = (pick: (c: BudgetCategory) => number) =>
    data.categories.filter((c) => FLEXIBLE.has(c.kind)).reduce((s, c) => s + pick(c), 0);
  const spent = flexible((c) => c.spentWeek) + data.unsortedWeek;
  const lastWeek = flexible((c) => c.spentLastWeek) + data.unsortedLastWeek;
  const carry = allowance === null ? 0 : Math.max(0, lastWeek - allowance);
  const perWeek = safe === null ? null : Math.floor(safe / weeks);
  return {
    payday,
    daysToPayday: days,
    weeksToPayday: Math.round(weeks * 10) / 10,
    balance: data.balancePence,
    stillToPay,
    buffer,
    plannedBefore,
    safe,
    perWeek,
    week: {
      allowance,
      carry,
      spread,
      spent,
      left: allowance === null ? null : allowance - carry - spread - spent,
    },
    onTrack: perWeek === null || allowance === null ? null : perWeek >= allowance,
  };
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** What money_budget returns, as BudgetData. */
export function parseBudget(raw: unknown): BudgetData {
  const r = (raw ?? {}) as Row;
  const s = (r.settings ?? {}) as Row;
  const planned = (Array.isArray(r.planned) ? (r.planned as Row[]) : []).map((p) => ({
    id: num(p.id) ?? 0,
    name: str(p.name) ?? "",
    pence: num(p.pence) ?? 0,
    dueOn: str(p.due_on) ?? "",
    funding: str(p.funding) ?? "safe",
    weeks: num(p.weeks) ?? 1,
    addedBy: str(p.added_by) === "claude" ? ("claude" as const) : ("owner" as const),
  }));
  return {
    balancePence: num(r.balance_pence),
    allowancePence: num(s.allowance_pence),
    bufferPence: num(s.buffer_pence) ?? 0,
    bufferFrom: str(s.buffer_from),
    paydayRule: str(s.payday_rule) ?? "last-working-day",
    firstPayday: str(s.first_payday),
    categories: (Array.isArray(r.categories) ? (r.categories as Row[]) : []).map((c) => ({
      key: str(c.key) ?? "",
      name: str(c.name) ?? "",
      kind: str(c.kind) ?? "discretionary",
      budgetPence: num(c.budget_pence),
      paidMonth: num(c.paid_month) ?? 0,
      spentWeek: num(c.spent_week) ?? 0,
      spentLastWeek: num(c.spent_last_week) ?? 0,
    })),
    unsortedWeek: num(r.unsorted_week) ?? 0,
    unsortedLastWeek: num(r.unsorted_last_week) ?? 0,
    planned,
    bills: (Array.isArray(r.bills) ? (r.bills as Row[]) : []).map(parseBill),
  };
}

/** "160", "160.50" or "£1,200" as pence; empty is null; anything else is undefined. */
export function parsePounds(text: string): number | null | undefined {
  const t = text.replace(/[£,\s]/g, "");
  if (!t) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return undefined;
  const [whole, part = ""] = t.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/** The first of a day's month. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}
