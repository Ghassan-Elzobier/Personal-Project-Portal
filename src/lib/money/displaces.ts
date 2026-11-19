// "Can I afford it?", whole: the verdict and ways to pay (afford, in budget.ts), and
// what the purchase displaces in the owner's own terms. The Money page and Claude's
// money_afford tool both call affordCheck, so a button and a chat give one answer.
// It lives apart from budget.ts because it needs the payday plan (allocate.ts),
// which is itself built on the budget. Pure, so it is tested.

import { allocate } from "./allocate.ts";
import { afford, budgetView, type Afford, type BudgetData } from "./budget.ts";

export type Displaces = {
  /** The cost as days of the weekly amount, to one decimal. Null with no weekly amount set. */
  days_of_weekly_amount: number | null;
  /** How many weeks later the first goal still being saved for gets there. Null with no such goal. */
  first_goal_later_by_weeks: { goal: string; weeks: number } | null;
};

/**
 * What a cost displaces, in the owner's terms: days of the weekly amount, and how much
 * later the first goal still being saved for gets there. People weigh a purchase better
 * when what it displaces is named (Frederick et al. 2009).
 */
export function inYourTerms(data: BudgetData, today: string, pence: number): Displaces {
  const view = budgetView(data, today);
  const weekly = view.week.allowance;
  const plan = allocate(data, view.payday);
  const goal = plan?.shares.find((s) => s.kind !== "debt" && s.remaining > 0 && s.pence > 0);
  return {
    days_of_weekly_amount: weekly ? Math.round((pence / weekly) * 7 * 10) / 10 : null,
    first_goal_later_by_weeks:
      goal && plan ? { goal: goal.name, weeks: Math.ceil((pence / goal.pence) * (plan.weeks || 4.3)) } : null,
  };
}

export type AffordCheck = Afford & Displaces;

/** The verdict, the ways to pay and what it displaces, for a cost of `pence`. Reads only. */
export function affordCheck(data: BudgetData, today: string, pence: number, savesPerWeek = 0): AffordCheck {
  return { ...afford(data, today, pence, savesPerWeek), ...inYourTerms(data, today, pence) };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What it displaces, as a line for the page: "About 3 days of your weekly amount. Holiday gets there 2 weeks later." */
export function displacesText(check: Displaces): string {
  const days = check.days_of_weekly_amount;
  const goal = check.first_goal_later_by_weeks;
  const parts = [
    days === null
      ? null
      : days < 1
        ? "Less than a day of your weekly amount."
        : `About ${count(Math.round(days), "day", "days")} of your weekly amount.`,
    goal ? `${goal.goal} gets there ${count(goal.weeks, "week", "weeks")} later.` : null,
  ];
  return parts.filter(Boolean).join(" ");
}
