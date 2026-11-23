// The plan's waterfall: how each payday's pay is shared out, in the order best practice
// suggests and the owner can change. Pure, so it is tested; the Money page, Claude and
// the engine (which sets money aside on payday) all use it.
//
//   1. bills and debts' payments for the pay cycle
//   2. the weekly floor, for every week to the next payday
//   3. each goal in order, at its pace: what's still needed over the months to its day
//      (YNAB's "needed for spending"); a goal with no day takes a year
//   4. the weekly amount, raised up to the target
//   5. anything left, to the first goal not finished (a debt's extra payment)
//
// When pay can't cover the floor, the cycle is short; when it can't cover a goal's
// pace, the goals last in the order slow down first, and say when they'll finish now.

import { addDays } from "../dates/week.ts";
import { allowanceFrom, nextPayday, paydayIn, savedNow, stepStart, type BudgetData, type Goal } from "./budget.ts";
import { payOn } from "./forecast.ts";
import { CYCLE_DAYS, daysBetween, nextDue, occurrencesIn, yearlyPence } from "./recurring.ts";

const MONTH_DAYS = CYCLE_DAYS.monthly;
const FIXED = new Set(["bills", "savings"]);
/** A goal with no day is paced over a year. */
const DEFAULT_MONTHS = 12;
/** How far ahead a goal's day is looked for once pay steps change its share: 10 years. */
const HORIZON_MONTHS = 120;

export type Share = {
  id: number;
  name: string;
  kind: Goal["kind"];
  /** Given this cycle. */
  pence: number;
  /** What its pace asked for. */
  need: number;
  /** Still to reach (or, for a debt, still owed) before this cycle's share. */
  remaining: number;
  /**
   * The month it gets there ("2027-11"): at this cycle's share, and at the share each
   * later pay step would give from its payday on. Null when it never does.
   */
  finish: string | null;
  /** Given less than its pace asked. */
  slipped: boolean;
  /** Money that has to be moved: to a saver, or paid to a lender. */
  transfer: boolean;
};

export type Allocation = {
  from: string;
  to: string;
  weeks: number;
  pay: number;
  commitments: number;
  floor: number;
  /** The weekly amount the cycle allows: from the floor up to the target. */
  weekly: number;
  shares: Share[];
  /** Left after every goal is covered. */
  surplus: number;
  /** Pay doesn't cover bills and the floor. */
  short: boolean;
};

/** The goal's day, moved on a year at a time once passed, when it comes round each year. */
function dueFrom(g: Goal, from: string): string | null {
  if (!g.dueOn) return null;
  let d = g.dueOn;
  while (g.repeatsYearly && d < from) d = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
  return d;
}

function addMonths(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Months to clear a debt paying `payment` a month, with interest (APR in basis points). */
export function monthsToClear(owed: number, payment: number, aprBp: number | null): number | null {
  if (owed <= 0) return 0;
  if (payment <= 0) return null;
  const r = (aprBp ?? 0) / 10_000 / 12;
  if (r === 0) return Math.ceil(owed / payment);
  if (payment <= owed * r) return null;
  return Math.ceil(-Math.log(1 - (r * owed) / payment) / Math.log(1 + r));
}

/** How the pay cycle starting on a payday is shared out. Null without pay planned for it. */
export function allocate(data: BudgetData, from: string): Allocation | null {
  const pay = payOn(from, data.income ?? [], data.lastPay ?? null, data.paydayRule);
  if (pay <= 0) return null;
  const plan = shareOut(data, from, pay);
  const goals = data.goals ?? [];
  const months = daysBetween(from, plan.to) / MONTH_DAYS;
  const monthly = (a: Allocation, id: number) =>
    (a.shares.find((x) => x.id === id)?.pence ?? 0) / Math.max(0.25, months);

  // A later pay step changes what each goal gets from its payday on: walk the months
  // ahead, each at the share its payday's pay gives, until the goal is reached.
  const later = (data.income ?? []).some((s) => stepStart(s.fromOn, data.paydayRule) > from);
  const byPay = new Map<number, Allocation>([[pay, plan]]);
  const ahead = later
    ? Array.from({ length: HORIZON_MONTHS }, (_, i) => {
        const p = payOn(
          paydayIn(addMonths(from, i), data.paydayRule),
          data.income ?? [],
          data.lastPay ?? null,
          data.paydayRule,
        );
        if (!byPay.has(p)) byPay.set(p, shareOut(data, from, p));
        return byPay.get(p)!;
      })
    : [];

  for (const s of plan.shares) {
    const g = goals.find((x) => x.id === s.id)!;
    let n: number | null;
    if (s.remaining <= 0) n = 0;
    else if (!later) {
      const m = monthly(plan, s.id);
      n =
        s.kind === "debt"
          ? monthsToClear(s.remaining, (g.paymentPence ?? 0) + m, g.aprBp)
          : m > 0
            ? Math.ceil(s.remaining / m)
            : null;
    } else {
      const r = s.kind === "debt" ? (g.aprBp ?? 0) / 10_000 / 12 : 0;
      const payment = s.kind === "debt" ? (g.paymentPence ?? 0) : 0;
      let left = s.remaining;
      n = null;
      for (let i = 0; i < ahead.length; i++) {
        left = left * (1 + r) - payment - monthly(ahead[i], s.id);
        if (left <= 0) {
          n = i + 1;
          break;
        }
      }
    }
    s.finish = n === null ? null : addMonths(from, Math.max(0, n - 1));
  }
  return plan;
}

/** The waterfall for the cycle from a payday, with a given pay; each share's finish left for allocate. */
function shareOut(data: BudgetData, from: string, pay: number): Allocation {
  const to = nextPayday(from, data.paydayRule, data.firstPayday);
  const days = daysBetween(from, to);
  const weeks = days / 7;
  const months = days / MONTH_DAYS;
  const goals = (data.goals ?? [])
    .filter((g) => g.status === "active")
    .sort((a, b) => a.position - b.position || a.id - b.id);

  // 1. Bills on their days in the cycle; fixed categories without a bill found, by the
  // month; and a debt's payment when it isn't one of the bills already.
  // A bill with money put by for it in a goal is the goal's job, not this cycle's.
  const putBy = new Set(
    goals.filter((g) => g.kind === "sinking" && g.held === "account" && g.merchantKey).map((g) => g.merchantKey),
  );
  const active = (data.bills ?? []).filter((b) => b.status === "active");
  const bills = active.filter((b) => !putBy.has(b.merchantKey));
  const billed = new Set(active.map((b) => b.category).filter((c) => c !== null));
  const billMerchants = new Set(bills.map((b) => b.merchantKey));
  const commitments = Math.round(
    bills.reduce((s, b) => s + occurrencesIn(b, from, to).length * b.expectedPence, 0) +
      data.categories
        .filter((c) => FIXED.has(c.kind) && c.budgetPence && !billed.has(c.key))
        .reduce((s, c) => s + c.budgetPence! * months, 0) +
      goals
        .filter((g) => g.kind === "debt" && g.paymentPence && !(g.merchantKey && billMerchants.has(g.merchantKey)))
        .reduce((s, g) => s + Math.min(savedNow(g), g.paymentPence! * months), 0),
  );

  // 2. The floor.
  const floorWeek = data.weeklyFloorPence ?? 0;
  const floor = Math.round(floorWeek * weeks);
  let left = pay - commitments - floor;
  const short = left < 0;

  // 3. Goals at their pace.
  const shares: Share[] = goals.map((g) => {
    const owed = g.kind === "debt";
    const remaining = owed ? savedNow(g) : Math.max(0, (g.targetPence ?? 0) - savedNow(g));
    const due = dueFrom(g, from);
    const monthsLeft = due ? Math.max(1, Math.round(daysBetween(from, due) / MONTH_DAYS)) : DEFAULT_MONTHS;
    const need = owed ? 0 : Math.ceil(remaining / monthsLeft);
    const pence = Math.max(0, Math.min(need, left));
    left -= pence;
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      pence,
      need,
      remaining,
      finish: null,
      slipped: pence < need,
      transfer: owed || g.held === "elsewhere",
    };
  });

  // 4. Up to the target.
  const target = Math.max(floorWeek, allowanceFrom(data) ?? floorWeek);
  const raise = Math.max(0, Math.min(left, Math.round((target - floorWeek) * weeks)));
  left -= raise;
  const weekly = Math.min(target, Math.round((floorWeek + raise / weeks) / 100) * 100);

  // 5. The rest to the first goals not finished, debts included.
  for (const s of shares) {
    if (left <= 0) break;
    const room = s.remaining - s.pence;
    if (room <= 0) continue;
    const extra = Math.min(room, left);
    s.pence += extra;
    left -= extra;
  }

  return { from, to, weeks, pay, commitments, floor, weekly, shares, surplus: Math.max(0, left), short };
}

/** The pay cycle that has started (the latest payday on or before today), or null before the first. */
export function currentPayday(data: BudgetData, today: string): string | null {
  const next = nextPayday(today, data.paydayRule, data.firstPayday);
  // The payday before the next one: step back a month and take the next payday after that.
  const before = nextPayday(addDays(next, -40), data.paydayRule, null);
  const prev = before < next ? before : null;
  if (!prev || prev > today || (data.firstPayday && prev < data.firstPayday)) return null;
  return prev;
}

export type Suggested = {
  name: string;
  kind: Goal["kind"];
  targetPence: number;
  dueOn: string | null;
  repeatsYearly: boolean;
  held: Goal["held"];
  merchantKey: string | null;
};

/**
 * Goals to start from, worked out from what Money knows: an emergency fund of three
 * months of bills and groceries, kept in a separate saver; and money put by for each
 * yearly bill before it's due, kept in the account.
 */
export function suggestGoals(data: BudgetData, today: string): Suggested[] {
  const bills = (data.bills ?? []).filter((b) => b.status === "active");
  const groceries = data.categories.filter((c) => c.kind === "groceries").reduce((s, c) => s + (c.budgetPence ?? 0), 0);
  const monthly = bills.reduce((s, b) => s + yearlyPence(b), 0) / 12 + groceries;
  const out: Suggested[] = [];
  if (monthly > 0)
    out.push({
      name: "Emergency fund",
      kind: "saving",
      targetPence: Math.ceil((monthly * 3) / 10_000) * 10_000,
      dueOn: null,
      repeatsYearly: false,
      held: "elsewhere",
      merchantKey: null,
    });
  for (const b of bills.filter((x) => x.cadence === "yearly"))
    out.push({
      name: b.name ?? "A yearly bill",
      kind: "sinking",
      targetPence: b.expectedPence,
      dueOn: nextDue(b, today),
      repeatsYearly: true,
      held: "account",
      merchantKey: b.merchantKey,
    });
  const have = new Set((data.goals ?? []).map((g) => g.name.toLowerCase()));
  return out.filter((s) => !have.has(s.name.toLowerCase()));
}
