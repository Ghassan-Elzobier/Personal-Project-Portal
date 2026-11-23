// The forecast: your balance day by day for the next 13 weeks, from what Money knows —
// the bills on their days, each week's amount spent through the week, planned
// purchases on their days, and pay on each payday. Pure, so it is tested with a pinned
// day. It gives the lowest point (and when), the days under the buffer, and a
// checkpoint for each Monday: the balance the week should start with.
//
// whatIf runs the same forecast with changes (a different pay, a new regular cost,
// spending more or less a week, a one-off) and says how the lowest point and the
// balance at the end move, for "what if I switch to the bus?" or "what if the job
// pays more?".

import { addDays, weekdayIndex } from "../dates/week.ts";
import {
  allowanceFrom,
  billedCategories,
  budgetView,
  cyclePayday,
  EARLY_PAY_DAYS,
  fixedMonthly,
  mondayOf,
  nextPayday,
  paydayIn,
  stepStart,
  type BudgetData,
  type IncomeStep,
  type Planned,
} from "./budget.ts";
import { median } from "./median.ts";
import { dueUntil, type Bill, type Cadence } from "./recurring.ts";

export type Day = { day: string; pence: number };

export type Forecast = {
  /** The balance at the end of each day, today first. */
  points: Day[];
  lowest: Day;
  /** Days the balance ends under the buffer (once the buffer applies). */
  underBuffer: string[];
  /** The balance each Monday should start with: the Sunday before's end. */
  checkpoints: Day[];
  /** Each payday in the window, with the pay expected. */
  paydays: Day[];
  /** What moves the balance most: pay, bills and planned purchases (money out is negative). */
  events: { day: string; name: string; pence: number }[];
};

/** The budget, with its pay: the steps planned, and the latest pay received. */
export type ForecastData = BudgetData;

/** How close a pay must be to the plan's figure to count as it: within a fifth. */
export const PAY_BAND = 0.2;

/** Whether a pay is within PAY_BAND of the plan's figure. */
export function nearPlan(pence: number, planned: number): boolean {
  return Math.abs(pence - planned) <= planned * PAY_BAND;
}

/**
 * The pay among unsorted money in: the largest payment within 3 days of a payday (this
 * month's or last month's) that is at least half the pay expected then. Failing that,
 * pay that came early: the largest payment from EARLY_PAY_DAYS before the next payday
 * to today, within PAY_BAND of its pay. The engine sorts it as Pay, so the forecast
 * learns the real figure. Nothing without a plan.
 */
export function spotPay(
  incoming: { id: number; madeOn: string; pence: number }[],
  data: Pick<BudgetData, "paydayRule" | "firstPayday" | "income">,
  today: string,
): number | null {
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  let best: { id: number; pence: number } | null = null;
  for (const payday of [paydayIn(prev, data.paydayRule), paydayIn(month, data.paydayRule)]) {
    if (data.firstPayday && payday < addDays(data.firstPayday, -3)) continue;
    const expected = payOn(payday, data.income ?? [], null, data.paydayRule);
    if (expected <= 0) continue;
    for (const t of incoming) {
      const near = Math.abs(Date.parse(`${t.madeOn}T00:00:00Z`) - Date.parse(`${payday}T00:00:00Z`)) <= 3 * 86_400_000;
      if (near && t.pence >= expected / 2 && (!best || t.pence > best.pence)) best = t;
    }
  }
  if (best) return best.id;
  const next = nextPayday(today, data.paydayRule, data.firstPayday);
  const expected = payOn(next, data.income ?? [], null, data.paydayRule);
  if (expected <= 0) return null;
  const from = addDays(next, -EARLY_PAY_DAYS);
  for (const t of incoming)
    if (t.madeOn >= from && t.madeOn <= today && nearPlan(t.pence, expected) && (!best || t.pence > best.pence))
      best = t;
  return best?.id ?? null;
}

export const FORECAST_DAYS = 91;

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The step a payday's pay comes from: the latest starting on or before it. Given the
 * payday rule, a step starts on its month's payday (stepStart), whatever day of the
 * month it was typed for.
 */
function stepOn(payday: string, income: IncomeStep[], rule?: string): IncomeStep | undefined {
  const start = (s: IncomeStep) => (rule ? stepStart(s.fromOn, rule) : s.fromOn);
  return income
    .filter((s) => start(s) <= payday)
    .sort((a, b) => start(b).localeCompare(start(a)) || b.fromOn.localeCompare(a.fromOn))[0];
}

/** The first day a pay counts for a step: given the rule, EARLY_PAY_DAYS before its payday. */
const stepSince = (step: IncomeStep, rule?: string) =>
  rule ? addDays(stepStart(step.fromOn, rule), -EARLY_PAY_DAYS) : step.fromOn;

/**
 * The pay expected on a payday: the latest step starting on or before it (stepOn). When
 * a pay has come in since that step began and is within PAY_BAND of it, it's that pay
 * instead, so the first real payslip replaces an estimate without anyone typing it in;
 * given the rule, a pay that came early (as spotPay finds it) counts as that payday's.
 * One far from the step (a pro-rata first month, back pay) leaves the step's figure.
 */
export function payOn(payday: string, income: IncomeStep[], lastPay: Day | null, rule?: string): number {
  const step = stepOn(payday, income, rule);
  if (
    lastPay &&
    lastPay.day <= payday &&
    (!step || (lastPay.day >= stepSince(step, rule) && nearPlan(lastPay.pence, step.pence)))
  )
    return lastPay.pence;
  return step?.pence ?? 0;
}

/**
 * The plan's figure a payday uses instead of the last pay, when that pay came in since
 * the step began but was too far from it to learn. Null when the last pay is used.
 */
export function payIgnored(payday: string, income: IncomeStep[], lastPay: Day | null, rule?: string): number | null {
  const step = stepOn(payday, income, rule);
  if (!lastPay || !step || lastPay.day > payday || lastPay.day < stepSince(step, rule)) return null;
  return nearPlan(lastPay.pence, step.pence) ? null : step.pence;
}

/** A spread purchase's share of a week, or the whole of one paid from that week's amount. */
function weekShare(planned: Planned[], monday: string): number {
  return planned.reduce((s, p) => {
    const from = mondayOf(p.dueOn);
    if (p.funding === "allowance" && from === monday) return s + p.pence;
    if (p.funding === "spread" && monday >= from && monday <= addDays(from, 7 * (Math.max(1, p.weeks) - 1)))
      return s + Math.ceil(p.pence / Math.max(1, p.weeks));
    return s;
  }, 0);
}

export function forecast(data: ForecastData, today: string, days = FORECAST_DAYS): Forecast | null {
  if (data.balancePence === null) return null;
  const end = addDays(today, days - 1);
  const out = new Map<string, number>();
  const take = (day: string, pence: number) => out.set(day, (out.get(day) ?? 0) + pence);
  const events: Forecast["events"] = [];

  // Bills on their days (a late one today). A fixed category without a bill found keeps
  // its monthly budget (or its typical month), spread through each month (this month:
  // what's left of it).
  const bills = (data.bills ?? []).filter((b): b is Bill => b.status === "active");
  const billed = billedCategories(bills);
  for (const b of bills)
    for (const due of dueUntil(b, today, end)) {
      const day = due < today ? today : due;
      take(day, b.expectedPence);
      events.push({ day, name: b.name ?? "A bill", pence: -b.expectedPence });
    }
  const thisMonth = today.slice(0, 7);
  const daysLeftInMonth = daysIn(thisMonth) - Number(today.slice(8, 10)) + 1;
  for (const c of data.categories) {
    const monthly = billed.has(c.key) ? null : fixedMonthly(c)?.pence;
    if (!monthly) continue;
    for (let d = today; d <= end; d = addDays(d, 1)) {
      const month = d.slice(0, 7);
      take(d, month === thisMonth ? Math.max(0, monthly - c.paidMonth) / daysLeftInMonth : monthly / daysIn(month));
    }
  }

  // Each week's amount, spent through the week: what's left this week over its days,
  // then the weekly amount less any planned share, a seventh a day. A planned purchase
  // itself goes out on its day.
  const planned = data.planned ?? [];
  const leftThisWeek = Math.max(0, budgetView(data, today).week.left ?? 0);
  const thisWeek = mondayOf(today);
  const daysLeftInWeek = 7 - weekdayIndex(today);
  for (let d = today; d <= end; d = addDays(d, 1)) {
    const monday = mondayOf(d);
    take(
      d,
      monday === thisWeek
        ? leftThisWeek / daysLeftInWeek
        : Math.max(0, (allowanceFrom(data, d) ?? 0) - weekShare(planned, monday)) / 7,
    );
  }
  for (const p of planned) {
    const day = p.dueOn < today ? today : p.dueOn;
    if (day > end) continue;
    take(day, p.pence);
    events.push({ day, name: p.name, pence: -p.pence });
  }

  // Pay on each payday still to come (one paid early is in the balance already).
  const income = data.income ?? [];
  const paydays: Day[] = [];
  for (let p = cyclePayday(data, today); p <= end; p = nextPayday(p, data.paydayRule, data.firstPayday)) {
    const pence = payOn(p, income, data.lastPay ?? null, data.paydayRule);
    paydays.push({ day: p, pence });
    if (pence > 0) {
      take(p, -pence);
      events.push({ day: p, name: "Pay", pence });
    }
  }

  const points: Day[] = [];
  let balance = data.balancePence;
  for (let d = today; d <= end; d = addDays(d, 1)) {
    balance -= out.get(d) ?? 0;
    points.push({ day: d, pence: Math.round(balance) });
  }
  const checkpoints: Day[] = [];
  for (let i = 1; i < points.length; i++)
    if (weekdayIndex(points[i].day) === 0) checkpoints.push({ day: points[i].day, pence: points[i - 1].pence });
  const bufferOn = (d: string) => (!data.bufferFrom || data.bufferFrom <= d ? data.bufferPence : 0);
  return {
    points,
    lowest: points.reduce((lo, p) => (p.pence < lo.pence ? p : lo), points[0]),
    underBuffer: points.filter((p) => p.pence < bufferOn(p.day)).map((p) => p.day),
    checkpoints,
    paydays,
    events: events.sort((a, b) => a.day.localeCompare(b.day) || a.pence - b.pence),
  };
}

export type Change = {
  /** Take-home a month from the next payday on. */
  payPence?: number;
  /** Spend this much more each week (less, when negative). */
  weeklyChangePence?: number;
  /** A new regular cost, first paid on `on`. */
  bills?: { name: string; pence: number; cadence: Cadence; on: string }[];
  /** A one-off cost on a day. */
  oneOffs?: { name: string; pence: number; on: string }[];
  /** Bills that stop: none of the bill to this merchant falls due from `from` on. */
  ends?: { merchantKey: string; from: string }[];
};

export type Outlook = { lowest: Day; end: Day; daysUnderBuffer: number };

export type WhatIf = {
  before: Outlook;
  after: Outlook;
  /** How much the lowest point and the end balance move (better when positive). */
  lowestChange: number;
  endChange: number;
  /** The end change as a month's worth. */
  perMonth: number;
};

function outlook(f: Forecast): Outlook {
  return { lowest: f.lowest, end: f.points[f.points.length - 1], daysUnderBuffer: f.underBuffer.length };
}

/** The forecast with the changes, against the forecast as it is. Null without a balance. */
export function whatIf(data: ForecastData, today: string, change: Change): WhatIf | null {
  const base = forecast(data, today);
  if (!base) return null;
  const after = forecast(withChange(data, today, change), today)!;
  const a = outlook(after);
  const b = outlook(base);
  const endChange = a.end.pence - b.end.pence;
  return {
    before: b,
    after: a,
    lowestChange: a.lowest.pence - b.lowest.pence,
    endChange,
    perMonth: Math.round((endChange * 30.4) / FORECAST_DAYS),
  };
}

/** The budget as it would be with the changes. */
function withChange(data: ForecastData, today: string, change: Change): ForecastData {
  const next = cyclePayday(data, today);
  return {
    ...data,
    income:
      change.payPence === undefined
        ? data.income
        : [
            ...(data.income ?? []).filter((s) => s.fromOn < next),
            { fromOn: next, pence: change.payPence, grossYearPence: null },
          ],
    allowancePence:
      change.weeklyChangePence === undefined
        ? data.allowancePence
        : Math.max(0, (allowanceFrom(data) ?? 0) + change.weeklyChangePence),
    bills: [
      ...(data.bills ?? []).map((b) => {
        const end = change.ends?.find((e) => e.merchantKey === b.merchantKey);
        return end && !(b.endsOn && b.endsOn <= end.from) ? { ...b, endsOn: end.from } : b;
      }),
      ...(change.bills ?? []).map((b, i): Bill => ({
        id: -1 - i,
        ident: `what-if-${i}`,
        merchantKey: `what-if-${i}`,
        bandPence: null,
        name: b.name,
        cadence: b.cadence,
        anchorOn: b.on,
        expectedPence: b.pence,
        variable: false,
        category: null,
        status: "active",
        addedBy: "owner",
        createdAt: "",
        lastPaidOn: null,
        lastPence: null,
      })),
    ],
    planned: [
      ...(data.planned ?? []),
      ...(change.oneOffs ?? []).map((o) => ({ name: o.name, pence: o.pence, dueOn: o.on, funding: "safe", weeks: 1 })),
    ],
  };
}

// The forecast at your recent pace. A plan figure alone tends to be optimistic: people
// underestimate next week's spending, and the keenest savers most (Peetz & Buehler
// 2009), so the page sets the plan beside what you have really been spending. The pace
// is the median of your past weeks, a sturdy simple baseline (Hyndman & Athanasopoulos,
// FPP3 §5.2) that one unusual week can't drag.

const FLEXIBLE = new Set(["groceries", "essentials", "discretionary"]);
/** Fewer weeks of spending than this, and there is no pace to speak of. */
export const PACE_MIN_WEEKS = 4;
/** A pace within this of the plan matches it. */
export const PACE_MATCH_PENCE = 500;

/**
 * What you have spent a week lately: the median of the 8 weeks before this one, each
 * the flexible categories plus unsorted spending, from the first week with any. Null
 * with fewer than 4 such weeks.
 */
export function recentPace(data: ForecastData): number | null {
  const totals = Array.from({ length: 8 }, (_, k) =>
    data.categories
      .filter((c) => FLEXIBLE.has(c.kind))
      .reduce((s, c) => s + (c.weeks?.[k] ?? 0), data.unsortedWeeks?.[k] ?? 0),
  );
  const first = totals.findIndex((t) => t > 0);
  if (first < 0 || totals.length - first < PACE_MIN_WEEKS) return null;
  return median(totals.slice(first));
}

export type PaceOutlook = {
  /** The recent pace, a week. */
  pace: number;
  /** The weekly amount the plan runs on. */
  plan: number;
  /** The balance day by day at that pace. */
  points: Day[];
  /** The balance at the end of the next payday, if it falls in the window. */
  payday: Day | null;
  lowest: Day;
  /** Whether it goes under the buffer (under £0 before the buffer starts) before the next payday. */
  shortBeforePayday: boolean;
};

const bufferOn = (data: ForecastData, day: string) =>
  !data.bufferFrom || data.bufferFrom <= day ? data.bufferPence : 0;

/** Whether a forecast stays at or above the buffer every day before the next payday. */
function holdsToPayday(data: ForecastData, f: Forecast, payday: string): boolean {
  return f.points.every((p) => p.day >= payday || p.pence >= bufferOn(data, p.day));
}

/** The forecast with the weekly amount spent at the recent pace. Null without a pace, a plan or a balance. */
export function paceOutlook(data: ForecastData, today: string): PaceOutlook | null {
  const pace = recentPace(data);
  const plan = allowanceFrom(data);
  if (pace === null || plan === null || data.balancePence === null) return null;
  const f = forecast(withChange(data, today, { weeklyChangePence: pace - plan }), today)!;
  // The payday this cycle runs to, as the forecast puts its pay (an early pay counts as it).
  const next = cyclePayday(data, today);
  return {
    pace,
    plan,
    points: f.points,
    payday: f.points.find((p) => p.day === next) ?? null,
    lowest: f.lowest,
    shortBeforePayday: !holdsToPayday(data, f, next),
  };
}

export type FloorOutlook = {
  /** The least a week, as the plan sets it. */
  floor: number;
  /** The weekly amount the plan runs on. */
  plan: number;
  /** The balance day by day with each week spent at the floor. */
  points: Day[];
  lowest: Day;
};

/**
 * The best case: the forecast with each week's spending kept to the plan's floor (the
 * least a week). Null without a floor below the weekly amount, or without a balance.
 */
export function floorOutlook(data: ForecastData, today: string): FloorOutlook | null {
  const floor = data.weeklyFloorPence ?? null;
  const plan = allowanceFrom(data);
  if (!floor || plan === null || floor >= plan || data.balancePence === null) return null;
  const f = forecast(withChange(data, today, { weeklyChangePence: floor - plan }), today)!;
  return { floor, plan, points: f.points, lowest: f.lowest };
}

/**
 * The most a week, in whole pounds, whose forecast stays at or above the buffer (£0
 * before it starts) every day before the next payday. Only when it is less than the
 * weekly amount now: null when the plan already holds, or when not even £0 a week would.
 */
export function keepsAbove(data: ForecastData, today: string): number | null {
  const plan = allowanceFrom(data);
  if (plan === null || data.balancePence === null) return null;
  const next = cyclePayday(data, today);
  // Saving a weekly amount works this week's out afresh, so the trial does too.
  const holds = (pence: number) =>
    holdsToPayday(data, forecast({ ...data, allowancePence: pence, weekAmount: null }, today)!, next);
  if (holds(plan) || !holds(0)) return null;
  // Spending less never lowers the balance, so the pounds that hold run from 0 up to some amount.
  let lo = 0;
  let hi = Math.ceil(plan / 100);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (holds(mid * 100)) lo = mid;
    else hi = mid;
  }
  return lo * 100 < plan ? lo * 100 : null;
}
