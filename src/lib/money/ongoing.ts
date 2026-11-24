// A regular cost the owner wants to take on (a weekly session, a gym upgrade), kept as a
// goal of kind recurring, and the first payday it fits. Pure, so it is tested.
//
// The cost becomes a made-up bill inside the budget data (withOngoing), so the forecast,
// the payday share-out, safe-to-spend and the autopilot all count it from its start, and
// the bill it replaces stops counting from its first due day on or after the start (one
// payment later, given notice). Its setup fee is a one-off on the start day.
//
// A payday P is where it fits when it passes two tests, with the cost taken on from P:
//
//   keeps up  every pay cycle from P (to the end of the 12 paydays looked at, and at
//             least three) covers the bills and the cost, keeps the weekly amount at the
//             target (not the floor), and gives every goal ordered above it its full
//             pace. Goals below may slow down: that is the effect it has, and it is said.
//   cash      the forecast for a year, with the moves the plan makes to savers and
//             lenders each payday, stays at or above the buffer every day from P.
//
// Several regular costs go one by one in goal order, each seeing the ones before it as
// bills. The plan's answer sits beside the answer at the owner's recent pace (as the
// forecast does: a plan figure alone tends to be optimistic). A start the owner set is
// checked against both tests and kept, whether or not it passes.
//
// Once started, the payments that look like it (sent with the goal by the database) say
// it has been paid, and when Money adopts the real bill (after a few payments) the
// made-up one stops: the engine stores that bill on the goal.

import { addDays, weekdayIndex } from "../dates/week.ts";
import type { Allocation } from "./allocate.ts";
import {
  allowanceFrom,
  cyclePayday,
  nextPayday,
  parseBudget,
  sharedOut,
  type BudgetData,
  type Goal,
  type Planned,
  type Regular,
} from "./budget.ts";
import { forecast, recentPace } from "./forecast.ts";
import { walk } from "./moves.ts";
import { daysBetween, following, GAP, occurrencesIn, yearlyPence, type Bill } from "./recurring.ts";

/** How many paydays ahead a start is looked for. */
export const SEARCH_PAYDAYS = 12;
/** How far ahead the cash test looks: a year. */
export const CASH_DAYS = 365;
/** The fewest pay cycles a start must keep up for. */
const MIN_CYCLES = 3;
/** The cycles walked: enough to check the last payday looked at for MIN_CYCLES. */
const WALK = SEARCH_PAYDAYS + MIN_CYCLES - 1;

export type OngoingPlan = {
  id: number;
  name: string;
  /** The price is a guess: say "about". */
  estimated: boolean;
  /** What it costs, less the bill it replaces: a week and a month. */
  weeklyPence: number;
  monthlyPence: number;
  /** The start the owner set, or null for "start when it fits". */
  startOn: string | null;
  /** Whether the owner's start passes both tests; null with no start set. */
  startHolds: boolean | null;
  /** At the plan: the first payday it fits from. Null when not within a year. */
  fitsFrom: string | null;
  /** At the recent pace: the first payday it fits from (null: not within a year). Null with no pace yet. */
  atPace: { fitsFrom: string | null } | null;
  /** Which test fails from the next payday, when it does. */
  failing: "keeps-up" | "cash" | null;
  /** How much more a month it would need to keep up from the next payday. */
  gapMonthlyPence: number | null;
  /** The cash it would need first: the most the year goes under the buffer, from the next payday. */
  cashPence: number | null;
  /** The highest price that fits from the next payday, when that is less than the price. Null when it fits, or nothing does. */
  maxPence: number | null;
  /** Goals ordered below it that get less than their pace once it starts. */
  slows: string[];
  /** A payment for it has been seen, or its real bill found. */
  paid: boolean;
};

const regularOf = (g: Goal): Regular => g.regular!;
const isOngoing = (g: Goal) => g.kind === "recurring" && g.status === "active" && g.regular !== undefined;
const byOrder = (a: Goal, b: Goal) => a.position - b.position || a.id - b.id;

/** The made-up bill's id for a goal: negative, so never a real bill's (nor a what-if's). */
export const goalBillId = (g: Goal) => -1_000_000 - g.id;

/** The bills Money found in the bank, without the made-up ones regular costs add. */
export const foundBills = (bills: Bill[] = []) => bills.filter((b) => b.id > 0);

/** The first day the cost falls on from a start: for a weekly or fortnightly cost, its session day. */
function firstDay(r: Regular, start: string): string {
  if ((r.cadence !== "weekly" && r.cadence !== "fortnightly") || r.weekday === null) return start;
  let d = start;
  while (weekdayIndex(d) !== r.weekday) d = addDays(d, 1);
  return d;
}

/**
 * The payments that are it: the database sends those to the owner's merchant, or near
 * its price. Without a merchant, they're the merchant's whose payments come at its
 * cadence (the most, then the latest). Null before any.
 */
export function paidFor(r: Regular): { merchant: string | null; last: string } | null {
  const groups = new Map<string, Regular["payments"]>();
  for (const p of r.payments) groups.set(p.merchant ?? "", [...(groups.get(p.merchant ?? "") ?? []), p]);
  const [lo, hi] = GAP[r.cadence];
  let best: { merchant: string | null; last: string; count: number } | null = null;
  for (const [merchant, ps] of groups) {
    const days = [...new Set(ps.map((p) => p.on))].sort();
    const steady = days.every(
      (d, i) => i === 0 || (daysBetween(days[i - 1], d) >= lo && daysBetween(days[i - 1], d) <= hi),
    );
    if (!steady) continue;
    const last = days[days.length - 1];
    if (!best || days.length > best.count || (days.length === best.count && last > best.last))
      best = { merchant: merchant || null, last, count: days.length };
  }
  return best && { merchant: best.merchant, last: best.last };
}

/**
 * The real bill Money adopted for it: the one the engine stored, or an active bill found
 * at its cadence to its merchant (the owner's, or the one its payments went to). Null
 * until then.
 */
export function adoptedBill(g: Goal, bills: Bill[] = []): Bill | null {
  const r = regularOf(g);
  const real = foundBills(bills).filter((b) => b.status === "active");
  if (r.billId !== null) return real.find((b) => b.id === r.billId) ?? null;
  if (!r.startOn) return null;
  const merchants = new Set([g.merchantKey, paidFor(r)?.merchant].filter((m): m is string => !!m));
  return (
    real.find(
      (b) => merchants.has(b.merchantKey) && b.cadence === r.cadence && b.merchantKey !== r.replacesMerchantKey,
    ) ?? null
  );
}

/** The bill it replaces, while that is active. */
function replacedBill(g: Goal, bills: Bill[] = []): Bill | undefined {
  const key = regularOf(g).replacesMerchantKey;
  return key ? foundBills(bills).find((b) => b.status === "active" && b.merchantKey === key) : undefined;
}

/**
 * The budget with one regular cost taken on from `start` (at `pence` each time): its
 * made-up bill (until the real one is found), the bill it replaces ended from its first
 * due day on or after the start (or the one after, for notice), and its setup fee on the
 * start day while that is still to come.
 */
export function withCost(data: BudgetData, g: Goal, start: string, today: string, pence?: number): BudgetData {
  const r = regularOf(g);
  const bills = data.bills ?? [];
  const replaced = replacedBill(g, bills);
  let ends: string | null = null;
  if (replaced) {
    const first = occurrencesIn(replaced, start, addDays(start, 400))[0];
    ends = first ? (r.replaceOverlap ? following(replaced, first) : first) : null;
  }
  const paid = paidFor(r);
  const made: Bill[] = adoptedBill(g, bills)
    ? []
    : [
        {
          id: goalBillId(g),
          ident: `goal-${g.id}`,
          merchantKey: `goal-${g.id}`,
          bandPence: null,
          name: g.name,
          cadence: r.cadence,
          anchorOn: firstDay(r, start),
          expectedPence: pence ?? r.costPence,
          variable: false,
          // Never a category: a bills category with a bill found stops counting its month.
          category: null,
          status: "active",
          addedBy: "owner",
          createdAt: "",
          lastPaidOn: paid && paid.last >= addDays(start, -7) ? paid.last : null,
          lastPence: null,
        },
      ];
  const setup: Planned[] =
    r.setupPence && start >= today
      ? [{ name: `${g.name}: setting up`, pence: r.setupPence, dueOn: start, funding: "safe", weeks: 1 }]
      : [];
  return {
    ...data,
    bills: [...bills.map((b) => (b === replaced && ends ? { ...b, endsOn: ends } : b)), ...made],
    planned: [...(data.planned ?? []), ...setup],
  };
}

/** The paydays looked at: the next pay still to come, and the ones after it. */
function paydaysFrom(data: BudgetData, today: string): string[] {
  const out = [cyclePayday(data, today)];
  while (out.length < WALK) out.push(nextPayday(out[out.length - 1], data.paydayRule, data.firstPayday));
  return out;
}

/** The least weekly amount that counts as the target in a cycle (the share-out rounds to the £1). */
/**
 * Whether a cycle keeps up, and the goals below that slow: the pay covers the bills (the
 * cost among them) and the floor, the pace of every goal above, and the weekly amount
 * raised to the target; goals below get what is left after that, in order.
 */
function keepsUpIn(data: BudgetData, c: Allocation, above: Set<number>): { ok: boolean; slows: string[] } {
  const floor = data.weeklyFloorPence ?? 0;
  const target = Math.max(floor, allowanceFrom(data, c.from) ?? floor);
  const paced = c.shares.filter((s) => above.has(s.id)).reduce((t, s) => t + s.need, 0);
  let left = c.pay - c.commitments - c.floor - paced - Math.round((target - floor) * c.weeks);
  const ok = !c.short && left >= 0;
  const slows: string[] = [];
  for (const s of c.shares.filter((x) => !above.has(x.id) && x.need > 0)) {
    if (left < s.need) slows.push(s.name);
    left = Math.max(0, left - s.need);
  }
  return { ok, slows };
}

const bufferOn = (data: BudgetData, day: string) => (!data.bufferFrom || data.bufferFrom <= day ? data.bufferPence : 0);

type Check = { keepsUp: boolean; cash: boolean; cashShort: number; slows: string[] };

/** Both tests for the cost taken on from `start`, the pay cycle it falls in being paydays[k]. */
function check(data: BudgetData, g: Goal, start: string, today: string, paydays: string[], pence?: number): Check {
  const k = Math.max(
    0,
    paydays.findLastIndex((p) => p <= start),
  );
  const d = withCost(data, g, start, today, pence);
  const { plans, moves } = walk(d, paydays);
  const above = new Set((data.goals ?? []).filter((x) => sharedOut(x) && byOrder(x, g) < 0).map((x) => x.id));
  const cycles = plans.slice(k, Math.max(SEARCH_PAYDAYS, k + MIN_CYCLES));
  const keepsUp = cycles.every((c) => c !== null && keepsUpIn(d, c, above).ok);
  const slows = plans[k] ? keepsUpIn(d, plans[k], above).slows : [];

  // The cash: a year of the forecast, with each payday's moves to savers and lenders.
  const f = forecast(d, today, CASH_DAYS, moves);
  // Without a balance there is nothing to test the cash on.
  const worst = (f?.points ?? [])
    .filter((p) => p.day >= start)
    .reduce((lo, p) => Math.min(lo, p.pence - bufferOn(d, p.day)), 0);
  return { keepsUp, cash: worst >= 0, cashShort: -worst, slows };
}

const passes = (c: Check) => c.keepsUp && c.cash;

/** The first payday of the next 12 both tests pass from, or null. */
function firstFit(data: BudgetData, g: Goal, today: string, paydays: string[]): { start: string; check: Check } | null {
  for (const p of paydays.slice(0, SEARCH_PAYDAYS)) {
    const c = check(data, g, p, today, paydays);
    if (passes(c)) return { start: p, check: c };
  }
  return null;
}

/** What a cost comes to a month. */
const monthly = (pence: number, cadence: Regular["cadence"]) => yearlyPence({ cadence, expectedPence: pence }) / 12;

/** The highest price, in whole pounds, that passes from the next payday, when under the price. */
function highestPrice(data: BudgetData, g: Goal, today: string, paydays: string[]): number | null {
  const cost = regularOf(g).costPence;
  const fits = (pence: number) => passes(check(data, g, paydays[0], today, paydays, pence));
  if (fits(cost) || !fits(0)) return null;
  // A lower price never fits worse, so the pounds that fit run from 0 up to some price.
  let lo = 0;
  let hi = Math.ceil(cost / 100);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid * 100)) lo = mid;
    else hi = mid;
  }
  return lo * 100 < cost ? lo * 100 : null;
}

/** The start a regular cost counts from: the owner's, or the first payday it fits. Null when it doesn't. */
function startOf(data: BudgetData, g: Goal, today: string, paydays: string[]): string | null {
  return regularOf(g).startOn ?? firstFit(data, g, today, paydays)?.start ?? null;
}

/**
 * The budget with every regular cost counted, in goal order, each seeing the ones
 * before it: from the start the owner set, or the first payday it fits (not at all when
 * it doesn't fit within a year). Apply it right after reading the budget, so the page,
 * Today, the engine and Claude count the same thing.
 */
export function withOngoing(data: BudgetData, today: string): BudgetData {
  const goals = (data.goals ?? []).filter(isOngoing).sort(byOrder);
  if (!goals.length) return data;
  const paydays = paydaysFrom(data, today);
  let out = data;
  for (const g of goals) {
    const start = startOf(out, g, today, paydays);
    if (start) out = withCost(out, g, start, today);
  }
  return out;
}

/** The budget as the database sends it, with every regular cost counted: read every budget through this. */
export function budgetData(raw: unknown, today: string): BudgetData {
  return withOngoing(parseBudget(raw), today);
}

/** Each regular cost's card: when it fits at the plan and at the recent pace, and what it costs net. */
export function ongoingPlans(data: BudgetData, today: string): OngoingPlan[] {
  const goals = (data.goals ?? []).filter(isOngoing).sort(byOrder);
  const paydays = paydaysFrom(data, today);
  const pace = recentPace(data);
  const atPaceData: BudgetData | null = pace === null ? null : { ...data, allowancePence: pace, weekAmount: null };
  let before = data;
  let beforePace = atPaceData;
  const out: OngoingPlan[] = [];
  for (const g of goals) {
    const r = regularOf(g);
    const replaced = replacedBill(g, before.bills);
    const net =
      yearlyPence({ cadence: r.cadence, expectedPence: r.costPence }) - (replaced ? yearlyPence(replaced) : 0);

    const fit = firstFit(before, g, today, paydays);
    const owner = r.startOn ? check(before, g, r.startOn, today, paydays) : null;
    const next = fit?.start === paydays[0] ? fit.check : check(before, g, paydays[0], today, paydays);
    const max = !passes(next) || r.estimated ? highestPrice(before, g, today, paydays) : null;
    const paceFit = beforePace ? firstFit(beforePace, g, today, paydays) : null;
    const start = r.startOn ?? fit?.start ?? null;

    out.push({
      id: g.id,
      name: g.name,
      estimated: r.estimated,
      weeklyPence: Math.round(net / 52),
      monthlyPence: Math.round(net / 12),
      startOn: r.startOn,
      startHolds: owner ? passes(owner) : null,
      fitsFrom: fit?.start ?? null,
      atPace: beforePace ? { fitsFrom: paceFit?.start ?? null } : null,
      failing: passes(next) ? null : !next.keepsUp ? "keeps-up" : "cash",
      gapMonthlyPence: next.keepsUp
        ? null
        : Math.max(0, Math.round(monthly(r.costPence, r.cadence) - monthly(max ?? 0, r.cadence))),
      cashPence: next.cash ? null : next.cashShort,
      maxPence: max,
      slows: (owner ?? fit?.check)?.slows ?? [],
      paid: adoptedBill(g, before.bills) !== null || paidFor(r) !== null,
    });

    if (start) before = withCost(before, g, start, today);
    if (beforePace) {
      const s = r.startOn ?? paceFit?.start ?? null;
      if (s) beforePace = withCost(beforePace, g, s, today);
    }
  }
  return out;
}

/** The regular costs whose real bill Money has found but not yet stored on the goal: for the engine to store. */
export function billsToStore(data: BudgetData): { goal: number; bill: number }[] {
  return (data.goals ?? [])
    .filter((g) => isOngoing(g) && regularOf(g).billId === null)
    .flatMap((g) => {
      const b = adoptedBill(g, data.bills);
      return b ? [{ goal: g.id, bill: b.id }] : [];
    });
}
