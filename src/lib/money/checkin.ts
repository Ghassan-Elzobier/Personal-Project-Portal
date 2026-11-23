// The Monday check-in: early in the week, Today says in one line how last week went and
// asks one tap about it. The start of a week is a fresh start, when people act on their
// goals and file a slip under the week before (Dai, Milkman and Riis 2014), so it closes
// last week rather than dwelling on it. After an overspend the owner picks what happens
// to it, from the ways that fit, each saying what it does: a plan chosen at the moment
// it applies (Gollwitzer and Sheeran 2006), and money put by used as a named reserve that
// visibly costs its goal (Sharif and Shu 2021), never hidden or blamed.
//
// Shown Monday to Wednesday, with the bank connected and some spending last week, until
// the owner taps once. The sums are the weekly summary's (summary.ts).

import { weekdayIndex } from "../dates/week.ts";
import { mondayOf, savedNow, sharedOut, type BudgetData, type BudgetView, type CheckInRecord } from "./budget.ts";
import { pounds } from "./state.ts";
import { weekSummary } from "./summary.ts";

export type CheckInOption = {
  choice: CheckInRecord["choice"];
  /** The button's words. */
  label: string;
  /** The goal that covers it. */
  goal?: number;
};

export type CheckIn = {
  /** Last week's Monday: the week checked in on. */
  week: string;
  /** How far over its amount (0 when under or on it). */
  over: number;
  /** "Last week: £120.00 of £150.00, £30.00 under." */
  line: string;
  /** The category that moved most against the usual week, if one did. */
  moved: string | null;
  /** What happens without a choice: where the leftover went, or what the plan does with an overspend. */
  note: string;
  options: CheckInOption[];
};

/** The first goal kept in the account, in the plan's order, that holds at least `pence`. */
function coverFrom(data: BudgetData, pence: number) {
  return (data.goals ?? [])
    .filter((g) => g.status === "active" && g.kind !== "debt" && sharedOut(g) && g.held === "account")
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .find((g) => savedNow(g) >= pence);
}

export function checkIn(data: BudgetData, view: BudgetView, today: string): CheckIn | null {
  if (weekdayIndex(today) > 2 || data.balancePence === null) return null;
  const s = weekSummary(data, view, null, today);
  if (s.spent <= 0 || s.amount === null || data.checkin?.week === s.week) return null;
  const over = Math.max(0, s.spent - s.amount);
  const top = s.unusual[0];
  const base = {
    week: s.week,
    over,
    line: `Last week: ${pounds(s.spent)} of ${pounds(s.amount)}, ${over > 0 ? `${pounds(over)} over` : `${pounds(s.amount - s.spent)} under`}.`,
    moved: top ? `${top.name} ${pounds(top.spent)}, usually ${pounds(top.usual)}.` : null,
  };
  if (over === 0) {
    const swept = s.swept.map((x) => `${pounds(x.pence)} to ${x.name}`).join(", ");
    return {
      ...base,
      note: swept ? `What was left went to your goals: ${swept}.` : "What was left stays in what's safe to spend.",
      options: [{ choice: "ok", label: "Got it" }],
    };
  }
  const auto = view.week.auto;
  const options: CheckInOption[] = [{ choice: "keep", label: "Keep the plan" }];
  // Only once the engine has fixed this week's amount: there is nothing to lower before.
  if (auto && data.weekAmount?.of === mondayOf(today) && data.weekAmount.pence > 0)
    options.push({ choice: "week", label: "Take it off this week" });
  const goal = coverFrom(data, over);
  if (goal) options.push({ choice: "goal", label: `Cover it from ${goal.name}`, goal: goal.id });
  return {
    ...base,
    note: `Keep the plan and ${auto ? "the weeks to payday share it" : "it comes off this week"}.`,
    options,
  };
}
