// The weekly summary, written with no input: last week against its amount, what went to
// which goal, where spending was unusual against your own usual week, the next 7 days,
// the forecast's low point, and whether each goal is keeping its pace. Comparing with
// your own past spending is one of the few things shown to cut discretionary spending
// in a field trial (Levi 2025), so the comparison is with you, not a national average.

import { addDays } from "../dates/week.ts";
import { allocate } from "./allocate.ts";
import { allowanceFrom, mondayOf, type BudgetData, type BudgetView } from "./budget.ts";
import type { Day, Forecast } from "./forecast.ts";
import { median } from "./median.ts";

export type WeekSummary = {
  /** Last week's Monday. */
  week: string;
  /** Its amount (null on the autopilot before the engine has closed a week). */
  amount: number | null;
  spent: number;
  swept: { name: string; pence: number }[];
  /** Up to three categories well off their usual week (the median of the 7 before). */
  unusual: { name: string; spent: number; usual: number }[];
  next7: { day: string; name: string; pence: number }[];
  lowest: Day | null;
  goals: { name: string; onPace: boolean; finish: string | null }[];
};

const FLEXIBLE = new Set(["groceries", "essentials", "discretionary"]);

/** Last week against the usual: off by at least £5 and a quarter, biggest differences first. */
function unusual(data: BudgetData): WeekSummary["unusual"] {
  const rows = [
    ...data.categories
      .filter((c) => FLEXIBLE.has(c.kind) && c.weeks?.length === 8)
      .map((c) => ({ name: c.name, weeks: c.weeks! })),
    ...(data.unsortedWeeks?.length === 8 ? [{ name: "Not sorted yet", weeks: data.unsortedWeeks }] : []),
  ];
  return rows
    .map((r) => ({ name: r.name, spent: r.weeks[7], usual: median(r.weeks.slice(0, 7)) }))
    .filter((r) => Math.abs(r.spent - r.usual) >= 500 && Math.abs(r.spent - r.usual) >= Math.max(r.usual, 1) * 0.25)
    .sort((a, b) => Math.abs(b.spent - b.usual) - Math.abs(a.spent - a.usual))
    .slice(0, 3);
}

export function weekSummary(data: BudgetData, view: BudgetView, f: Forecast | null, today: string): WeekSummary {
  const week = addDays(mondayOf(today), -7);
  const closed = data.lastWeek?.week === week ? data.lastWeek : null;
  const spent =
    closed?.spentPence ??
    data.categories.filter((c) => FLEXIBLE.has(c.kind)).reduce((s, c) => s + c.spentLastWeek, 0) +
      data.unsortedLastWeek;
  const plan = allocate(data, view.payday);
  return {
    week,
    amount: closed?.amountPence ?? (view.week.auto ? null : allowanceFrom(data)),
    spent,
    swept: (closed?.swept ?? []).map((s) => ({ name: s.name, pence: s.pence })),
    unusual: unusual(data),
    next7: (f?.events ?? []).filter((e) => e.day > today && e.day <= addDays(today, 7)),
    lowest: f?.lowest ?? null,
    goals: (plan?.shares ?? []).map((s) => ({ name: s.name, onPace: !s.slipped, finish: s.finish })),
  };
}
