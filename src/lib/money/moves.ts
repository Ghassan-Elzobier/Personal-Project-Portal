// What the plan moves out of the account on each payday: each goal's share that has to
// leave it (to a saver held elsewhere, or paid to a lender), and a debt's monthly payment
// when no bill to its lender is found already. The forecast takes these off like a bill,
// so its line, lowest point and checkpoints agree with the share-out on the Goals card.
// Pure, so it is tested.
//
// One walk serves the forecast and the regular-cost test (ongoing.ts): each payday's
// share-out runs on what the goals hold by then.

import { afterCycle, shareOut, type Allocation } from "./allocate.ts";
import { cyclePayday, nextPayday, savedNow, type BudgetData } from "./budget.ts";
import { FORECAST_DAYS, payOn, type Move } from "./forecast.ts";
import { addDays } from "../dates/week.ts";
import { CYCLE_DAYS, daysBetween } from "./recurring.ts";

export type Walk = {
  /** The share-out of each payday in turn; null for a payday with no pay planned. */
  plans: (Allocation | null)[];
  /** What each payday moves out of the account, one per goal, named after it. */
  moves: Move[];
};

/** The share-out of each payday in turn, the goals filling as they go, and the moves each makes. */
export function walk(data: BudgetData, paydays: string[]): Walk {
  let goals = data.goals ?? [];
  const billed = new Set((data.bills ?? []).filter((b) => b.status === "active").map((b) => b.merchantKey));
  const moves: Move[] = [];
  const plans = paydays.map((day) => {
    const pay = payOn(day, data.income ?? [], data.lastPay ?? null, data.paydayRule);
    if (pay <= 0) return null;
    const plan = shareOut({ ...data, goals }, day, pay);
    const months = daysBetween(plan.from, plan.to) / CYCLE_DAYS.monthly;
    for (const s of plan.shares) {
      const g = goals.find((x) => x.id === s.id)!;
      const found = !!g.merchantKey && billed.has(g.merchantKey);
      // A standing order to a saver found as a bill goes out as that bill already.
      const share = s.transfer && !(g.kind !== "debt" && found) ? s.pence : 0;
      // A debt's payment, as the share-out counts it, when no bill is found for it.
      const payment =
        g.kind === "debt" && g.paymentPence && !found ? Math.min(savedNow(g), g.paymentPence * months) : 0;
      const pence = Math.round(share + payment);
      if (pence > 0) moves.push({ day, name: g.name, pence });
    }
    goals = afterCycle(goals, plan);
    return plan;
  });
  return { plans, moves };
}

/** The moves of every payday from the next pay still to come, within `days` from today. */
export function paydayMoves(data: BudgetData, today: string, days = FORECAST_DAYS): Move[] {
  const end = addDays(today, days - 1);
  const paydays: string[] = [];
  for (let p = cyclePayday(data, today); p <= end; p = nextPayday(p, data.paydayRule, data.firstPayday))
    paydays.push(p);
  return walk(data, paydays).moves;
}
