// The plan's waterfall: how each payday's pay is shared out, in the order best practice
// suggests and the owner can change. Pure, so it is tested; the Money page, Claude and
// the engine (which sets money aside on payday) all use it.
//
//   1. bills and debts' payments for the pay cycle
//   2. the weekly floor, for every week to the next payday
//   3. each goal in order, at its pace: what's still needed over the months to its day
//      (YNAB's "needed for spending"); a goal with no day takes a year
//   3b. after a pay rise, the share of the extra the owner chose for goals, in order
//      (Save More Tomorrow: part of each rise committed in advance); the rest of the
//      extra raises the weekly target in step 4
//   4. the weekly amount, raised up to the target
//   5. anything left, to the first goal not finished (a debt's extra payment)
//
// When pay can't cover the floor, the cycle is short; when it can't cover a goal's
// pace, the goals last in the order slow down first, and say when they'll finish now;
// when a higher pay step is coming, they are held until its first payday instead.

import { addDays } from "../dates/week.ts";
import { allowanceFrom, nextPayday, raiseAhead, raiseToGoals, savedNow, type BudgetData, type Goal } from "./budget.ts";
import { payOn } from "./forecast.ts";
import { CYCLE_DAYS, daysBetween, nextDue, occurrencesIn, yearlyPence } from "./recurring.ts";

const MONTH_DAYS = CYCLE_DAYS.monthly;
const FIXED = new Set(["bills", "savings"]);
/** A goal with no day is paced over a year. */
const DEFAULT_MONTHS = 12;

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
  /** The month it gets there at this rate ("2027-11"), or null when it gets nothing. */
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
  const pay = payOn(from, data.income ?? [], data.lastPay ?? null);
  if (pay <= 0) return null;
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
  // A goal short of its pace is held, not behind, when a higher pay step ahead keeps it.
  const rise = raiseAhead(data, from);
  const later = rise ? allocate(data, rise.on) : null;
  const caughtUp = (id: number) => later?.shares.some((s) => s.id === id && !s.slipped && !s.held) ?? false;
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
      slipped: pence < need && !caughtUp(g.id),
      held: pence < need && caughtUp(g.id),
      startsOn: pence < need && caughtUp(g.id) ? rise!.on : null,
      transfer: owed || g.held === "elsewhere",
    };
  });

  // 3b. The goals' share of a pay rise, in order, up to each one's room. What they can't
  // take flows on.
  const give = (pence: number) => {
    let out = Math.max(0, Math.min(pence, left));
    for (const s of shares) {
      if (out <= 0) break;
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

  for (const s of shares) {
    const g = goals.find((x) => x.id === s.id)!;
    const monthly = s.pence / Math.max(0.25, months);
    const n =
      s.kind === "debt"
        ? monthsToClear(s.remaining, (g.paymentPence ?? 0) + monthly, g.aprBp)
        : s.remaining <= 0
          ? 0
          : monthly > 0
            ? Math.ceil(s.remaining / monthly)
            : null;
    s.finish = n === null ? null : addMonths(from, Math.max(0, n - 1));
  }

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
  let goals = (data.goals ?? []).filter((g) => g.status === "active");
  for (const g of goals) out.set(g.id, null);
  let day = from;
  for (let i = 0; i < paydays; i++) {
    const plan = allocate({ ...data, goals }, day);
    if (!plan) break;
    const months = daysBetween(plan.from, plan.to) / MONTH_DAYS;
    goals = goals.map((g) => {
      const s = plan.shares.find((x) => x.id === g.id);
      if (!s) return g;
      if (g.kind === "debt") {
        const paid = s.pence + Math.min(savedNow(g), (g.paymentPence ?? 0) * months);
        return { ...g, savedPence: Math.max(0, g.savedPence - Math.round(paid)) };
      }
      return { ...g, savedPence: g.savedPence + s.pence };
    });
    for (const g of goals) {
      const left = g.kind === "debt" ? savedNow(g) : (g.targetPence ?? 0) - savedNow(g);
      if (left <= 0 && out.get(g.id) === null) out.set(g.id, day.slice(0, 7));
    }
    if ([...out.values()].every((m) => m !== null)) break;
    day = plan.to;
  }
  return out;
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
