// The plan's waterfall: how each payday's pay is shared out, in the order best practice
// suggests and the owner can change. Pure, so it is tested; the Money page, Claude and
// the engine (which sets money aside on payday) all use it.
//
//   1. bills and debts' payments for the pay cycle
//   2. the weekly floor, for every week to the next payday
//   3. each goal in order, at its pace: what's still needed over the months to its day
//      (YNAB's "needed for spending"); a goal with no day takes a year; a saving goal
//      with a monthly amount (payment_pence) takes that, and no more
//   3b. after a pay rise, the share of the extra the owner chose for goals, in order
//      (Save More Tomorrow: part of each rise committed in advance); the rest of the
//      extra raises the weekly target in step 4
//   4. the weekly amount, raised up to the target
//   5. anything left, to the first goal not finished (a debt's extra payment), except a
//      saving goal with a monthly amount: what's left after that stays in the account
//
// When pay can't cover the floor, the cycle is short; when it can't cover a goal's
// pace, the goals last in the order slow down first, and say when they'll finish now;
// when a higher pay step is coming, they are held until its first payday instead.

import { addDays } from "../dates/week.ts";
import {
  allowanceFrom,
  billedCategories,
  EARLY_PAY_DAYS,
  fixedMonthly,
  nextPayday,
  paidEarly,
  paydayIn,
  raiseAhead,
  raiseToGoals,
  savedNow,
  sharedOut,
  stepStart,
  type BudgetData,
  type Goal,
} from "./budget.ts";
import { payOn } from "./forecast.ts";
import { CYCLE_DAYS, daysBetween, nextDue, occurrencesIn, yearlyPence } from "./recurring.ts";

const MONTH_DAYS = CYCLE_DAYS.monthly;
/** A saving goal (or yearly cost) the owner gave a monthly amount: it takes that each month, and no more. */
const capped = (g: Goal) => g.kind !== "debt" && (g.paymentPence ?? 0) > 0;

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
  /** Given less than its pace asked, with no higher pay coming. */
  slipped: boolean;
  /** Given less than its pace asked, but a higher pay step is coming: it catches up from startsOn. */
  held: boolean;
  /** When held: the first payday on the higher pay. */
  startsOn: string | null;
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

/** The month `n` months on from a day's month ("2027-11"). */
export function addMonths(day: string, n: number): string {
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

/**
 * The waterfall for the cycle from a payday, with a given pay; each share's finish left
 * for allocate. A regular cost isn't shared out: it is a bill by then (ongoing.ts).
 */
export function shareOut(data: BudgetData, from: string, pay: number): Allocation {
  const to = nextPayday(from, data.paydayRule, data.firstPayday);
  const days = daysBetween(from, to);
  const weeks = days / 7;
  const months = days / MONTH_DAYS;
  const goals = (data.goals ?? [])
    .filter((g) => g.status === "active" && sharedOut(g))
    .sort((a, b) => a.position - b.position || a.id - b.id);

  // 1. Bills on their days in the cycle; fixed categories without a bill found, by the
  // month (their budget, or their typical month); and a debt's payment when it isn't one of the bills already.
  // A bill with money put by for it in a goal is the goal's job, not this cycle's.
  const putBy = new Set(
    goals.filter((g) => g.kind === "sinking" && g.held === "account" && g.merchantKey).map((g) => g.merchantKey),
  );
  const active = (data.bills ?? []).filter((b) => b.status === "active");
  const bills = active.filter((b) => !putBy.has(b.merchantKey));
  const billed = billedCategories(active);
  const billMerchants = new Set(bills.map((b) => b.merchantKey));
  const commitments = Math.round(
    bills.reduce((s, b) => s + occurrencesIn(b, from, to).length * b.expectedPence, 0) +
      data.categories
        .filter((c) => !billed.has(c.key))
        .reduce((s, c) => s + (fixedMonthly(c)?.pence ?? 0) * months, 0) +
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
  // A goal short of its pace is held, not behind, when a higher pay step ahead keeps it.
  const rise = raiseAhead(data, from);
  const later = rise ? allocate(data, rise.on) : null;
  const caughtUp = (id: number) => later?.shares.some((s) => s.id === id && !s.slipped && !s.held) ?? false;
  const shares: Share[] = goals.map((g) => {
    const owed = g.kind === "debt";
    const remaining = owed ? savedNow(g) : Math.max(0, (g.targetPence ?? 0) - savedNow(g));
    const due = dueFrom(g, from);
    const monthsLeft = due ? Math.max(1, Math.round(daysBetween(from, due) / MONTH_DAYS)) : DEFAULT_MONTHS;
    const need = owed ? 0 : capped(g) ? Math.min(remaining, g.paymentPence!) : Math.ceil(remaining / monthsLeft);
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
      slipped: pence < need && !caughtUp(g.id),
      held: pence < need && caughtUp(g.id),
      startsOn: pence < need && caughtUp(g.id) ? rise!.on : null,
      transfer: owed || g.held === "elsewhere",
    };
  });

  // 3b. The goals' share of a pay rise, in order, up to each one's room. What they can't
  // take flows on. A goal with a monthly amount takes no more than it.
  const fixed = new Set(goals.filter(capped).map((g) => g.id));
  const give = (pence: number) => {
    let out = Math.max(0, Math.min(pence, left));
    for (const s of shares) {
      if (out <= 0) break;
      if (fixed.has(s.id)) continue;
      const extra = Math.min(Math.max(0, s.remaining - s.pence), out);
      s.pence += extra;
      left -= extra;
      out -= extra;
    }
  };
  give(raiseToGoals(data, from));

  // 4. Up to the target (raised by the part of a rise kept to live on).
  const target = Math.max(floorWeek, allowanceFrom(data, from) ?? floorWeek);
  const raise = Math.max(0, Math.min(left, Math.round((target - floorWeek) * weeks)));
  left -= raise;
  const weekly = Math.min(target, Math.round((floorWeek + raise / weeks) / 100) * 100);

  // 5. The rest to the first goals not finished, debts included.
  give(left);

  return { from, to, weeks, pay, commitments, floor, weekly, shares, surplus: Math.max(0, left), short };
}

/** How many paydays ahead the goal dates look: three years. */
export const WALK_PAYDAYS = 36;

/**
 * The month each goal gets there, walking the paydays ahead: each runs the waterfall on
 * what the goals hold by then, so a pay step later on (and the share of it the owner
 * chose) moves the dates. Null when it doesn't get there within the walk.
 */
export function goalDates(data: BudgetData, from: string, paydays = WALK_PAYDAYS): Map<number, string | null> {
  const out = new Map<number, string | null>();
  let goals = (data.goals ?? []).filter((g) => g.status === "active" && sharedOut(g));
  for (const g of goals) out.set(g.id, null);
  let day = from;
  for (let i = 0; i < paydays; i++) {
    const plan = allocate({ ...data, goals }, day);
    if (!plan) break;
    goals = afterCycle(goals, plan);
    for (const g of goals) {
      const left = g.kind === "debt" ? savedNow(g) : (g.targetPence ?? 0) - savedNow(g);
      if (left <= 0 && out.get(g.id) === null) out.set(g.id, day.slice(0, 7));
    }
    if ([...out.values()].every((m) => m !== null)) break;
    day = plan.to;
  }
  return out;
}

/** The goals after a cycle's shares have gone to them: saved on, or a debt paid down by its share and payment. */
export function afterCycle(goals: Goal[], plan: Allocation): Goal[] {
  const months = daysBetween(plan.from, plan.to) / MONTH_DAYS;
  return goals.map((g) => {
    const s = plan.shares.find((x) => x.id === g.id);
    if (!s) return g;
    if (g.kind === "debt") {
      const paid = s.pence + Math.min(savedNow(g), (g.paymentPence ?? 0) * months);
      return { ...g, savedPence: Math.max(0, g.savedPence - Math.round(paid)) };
    }
    return { ...g, savedPence: g.savedPence + s.pence };
  });
}

/**
 * The pay cycle that has started (the latest payday on or before today), or null before
 * the first. A payday whose pay landed early has started from the day it landed.
 */
export function currentPayday(data: BudgetData, today: string): string | null {
  const early = paidEarly(data, today);
  if (early) return early;
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
 * months of essential outgoings (MoneyHelper's measure: the bills found, the bills
 * categories no bill covers at their budget or typical month, groceries and essentials),
 * kept in a separate saver; and money put by for each yearly bill before it's due, kept
 * in the account.
 */
export function suggestGoals(data: BudgetData, today: string): Suggested[] {
  // Only bills Money found: a regular cost's made-up bill (negative id) is a goal already.
  const bills = (data.bills ?? []).filter((b) => b.status === "active" && b.id > 0);
  const billed = billedCategories(bills);
  const essential = data.categories.reduce((s, c) => {
    if (c.kind === "groceries" || c.kind === "essentials") return s + (c.budgetPence ?? 0);
    if (c.kind === "bills" && !billed.has(c.key)) return s + (fixedMonthly(c)?.pence ?? 0);
    return s;
  }, 0);
  const monthly = bills.reduce((s, b) => s + yearlyPence(b), 0) / 12 + essential;
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

export type SuggestedDebt = { billId: number; name: string; paymentPence: number };

/**
 * Debts to start watching: each active bill in Debt repayments whose lender no active
 * debt goal is linked to, with what it costs a month. The owner says what's owed.
 */
export function suggestDebts(data: BudgetData): SuggestedDebt[] {
  const watched = new Set(
    (data.goals ?? [])
      .filter((g) => g.kind === "debt" && g.status === "active" && g.merchantKey)
      .map((g) => g.merchantKey),
  );
  return (data.bills ?? [])
    .filter((b) => b.status === "active" && b.category === "debts" && !watched.has(b.merchantKey))
    .map((b) => ({ billId: b.id, name: b.name ?? "A debt", paymentPence: Math.round(yearlyPence(b) / 12) }));
}

export type Debt = { id: number; owed: number; payment: number; aprBp: number | null };
/** How long until every debt is cleared, and the interest paid on the way; null months when it never clears. */
export type Payoff = { months: number | null; interestPence: number };

/** Give up after 50 years: a payment that barely beats the interest. */
const MAX_MONTHS = 600;

/**
 * Pays debts off month by month: interest goes on, each debt gets its payment, and
 * `extra` a month (plus the payments of debts already cleared) goes to the first in
 * the order still owing.
 */
function simulate(debts: Debt[], extra: number): Payoff {
  const owed = debts.map((d) => d.owed);
  let interest = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    let pool = extra;
    debts.forEach((d, i) => {
      if (owed[i] <= 0) {
        pool += d.payment;
        return;
      }
      const added = (owed[i] * (d.aprBp ?? 0)) / 10_000 / 12;
      interest += added;
      owed[i] = owed[i] + added - d.payment;
      if (owed[i] < 0) {
        pool -= owed[i];
        owed[i] = 0;
      }
    });
    for (let i = 0; i < debts.length && pool > 0; i++) {
      const paid = Math.min(owed[i], pool);
      owed[i] -= paid;
      pool -= paid;
    }
    if (owed.every((o) => o <= 0.5)) return { months: month, interestPence: Math.round(interest) };
  }
  return { months: null, interestPence: Math.round(interest) };
}

/** One debt paid at `payment` a month (APR in basis points): when it clears, and the interest on the way. */
export function payoff(owed: number, payment: number, aprBp: number | null): Payoff {
  if (owed <= 0) return { months: 0, interestPence: 0 };
  return simulate([{ id: 0, owed, payment, aprBp }], 0);
}

export type DebtOrder = { by: "rate" | "balance"; order: number[] } & Payoff;

/**
 * The two orders to pay extra off debts in, each with when the last one clears and the
 * interest paid: highest interest first, and smallest balance first. A cleared debt's
 * payment rolls on to the next.
 */
export function debtOrders(debts: Debt[], extraMonthly: number): DebtOrder[] {
  const apr = (d: Debt) => d.aprBp ?? 0;
  const sorts: Record<DebtOrder["by"], (a: Debt, b: Debt) => number> = {
    rate: (a, b) => apr(b) - apr(a) || a.owed - b.owed || a.id - b.id,
    balance: (a, b) => a.owed - b.owed || apr(b) - apr(a) || a.id - b.id,
  };
  return (["rate", "balance"] as const).map((by) => {
    const sorted = [...debts].sort(sorts[by]);
    return { by, order: sorted.map((d) => d.id), ...simulate(sorted, Math.max(0, extraMonthly)) };
  });
}

/**
 * The whole goal order with the debts put in `debtOrder`: each other goal keeps its
 * place, and the debts take the places debts had. Goals not done, first first.
 */
export function withDebtOrder(goals: Goal[], debtOrder: number[]): number[] {
  const listed = goals.filter((g) => g.status !== "done").sort((a, b) => a.position - b.position || a.id - b.id);
  const moving = new Set(debtOrder);
  const queue = debtOrder.filter((id) => listed.some((g) => g.id === id));
  return listed.map((g) => (moving.has(g.id) ? queue.shift()! : g.id));
}

/** The day a payday's pay came in: the day it landed when it came early, else the payday. */
export function payLanded(data: BudgetData, payday: string): string {
  const landed = data.lastPay?.day;
  return landed && landed < payday && landed >= addDays(payday, -EARLY_PAY_DAYS) ? landed : payday;
}
