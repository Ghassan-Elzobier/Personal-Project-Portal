// Money joined to the rest of the portal. Domains never import each other, so this is
// where Money meets the meal plan, the gym and the job hunt: the shops due before Monday
// set against this week's amount, what the gym costs a visit, and what a role's salary would do to the plan. Pure; the
// pages pass in what they have loaded.

import { addDays } from "../dates/week.ts";
import type { SessionLog } from "../life/gym/progress.ts";
import { buildList, listTotal } from "../life/shopping.ts";
import { kitchenFor, remainingNeeds, tripLists, weekView, type LifeState, type WeekView } from "../life/state.ts";
import type { Salary } from "../jobs/salary.ts";
import { allocate } from "../money/allocate.ts";
import { cyclePayday, mondayOf, type BudgetData } from "../money/budget.ts";
import { payOn } from "../money/forecast.ts";
import { yearlyPence } from "../money/recurring.ts";
import { pounds } from "../money/state.ts";
import { takeHome } from "../money/takehome.ts";

/**
 * What the meal plan still has to buy before Monday, cupboard staples included (they're
 * paid for at the same till), to set against this money week. The money week runs
 * Monday to Sunday but a meal week starts on the first cook's day, so each shop is
 * placed by its own date, from this meal week or the next: a fresh week's open shops
 * dated on or before Sunday, by their prices; a batch week's one shop, due on the week's
 * first day, until the delivery comes, at the checkout total once it's ordered (the
 * estimate before). Nothing without a plan.
 */
export function plannedShop(s: LifeState): number {
  const sunday = addDays(mondayOf(s.today), 6);
  return (["this", "next"] as const).reduce((t, which) => t + shopDueBy(s, weekView(s, which), sunday), 0);
}

/** One meal week's shopping still to pay for that is due on or before a day. */
function shopDueBy(s: LifeState, v: WeekView, by: string): number {
  const plan = v.plan;
  if (!plan) return 0;
  if (plan.mode === "fresh")
    return tripLists(s, v)
      .open.filter((x) => x.trip.date <= by)
      .reduce((t, x) => t + listTotal(x.lines).pence, 0);
  if (v.start > by || plan.shop?.deliveredOn) return 0;
  if (plan.shop?.orderedOn && plan.shop.orderedPence != null) return plan.shop.orderedPence;
  return listTotal(buildList(remainingNeeds(s, v), kitchenFor(s, v), s.products, s.profile.food, s.today)).pence;
}

/** What the gym's bills cost a month, and a visit this month so far. Null without a gym bill. */
export function gymCost(
  data: BudgetData,
  sessions: SessionLog[],
  today: string,
): { monthly: number; visits: number; perVisit: number | null } | null {
  const bills = (data.bills ?? []).filter((b) => b.status === "active" && b.category === "fitness");
  if (!bills.length) return null;
  const monthly = Math.round(bills.reduce((t, b) => t + yearlyPence(b), 0) / 12);
  const visits = sessions.filter((x) => x.day.slice(0, 7) === today.slice(0, 7) && x.day <= today).length;
  return { monthly, visits, perVisit: visits ? Math.round(monthly / visits) : null };
}

const monthYear = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * What a role's salary means for the plan, in a few lines: its take-home a month, the
 * change from the pay planned now, and when the first goal would get there instead.
 */
export function roleMoney(salary: Salary | null, data: BudgetData, today: string): string[] {
  if (!salary) return [];
  const lo = takeHome({ grossYearPence: salary.minPence }).monthPence;
  const hi = takeHome({ grossYearPence: salary.maxPence }).monthPence;
  const mid = Math.round((lo + hi) / 2);
  const lines = [
    lo === hi
      ? `About ${pounds(lo)} a month after tax and NI.`
      : `About ${pounds(lo)} to ${pounds(hi)} a month after tax and NI.`,
  ];
  const payday = cyclePayday(data, today);
  const now = payOn(payday, data.income ?? [], data.lastPay ?? null, data.paydayRule);
  if (now > 0) {
    const diff = mid - now;
    lines.push(`${diff >= 0 ? `${pounds(diff)} a month more` : `${pounds(-diff)} a month less`} than your pay now.`);
    const before = allocate(data, payday);
    const after = allocate({ ...data, income: [{ fromOn: payday, pence: mid, grossYearPence: null }] }, payday);
    const first = before?.shares.find((x) => x.kind !== "debt" && x.remaining > 0);
    const then = after?.shares.find((x) => x.id === first?.id);
    if (first && then?.finish && then.finish !== first.finish)
      lines.push(
        `${first.name}: there by ${monthYear(then.finish)}${first.finish ? ` instead of ${monthYear(first.finish)}` : ""}.`,
      );
  }
  return lines;
}
