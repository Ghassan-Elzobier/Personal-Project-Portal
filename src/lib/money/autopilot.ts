// What the engine does with the plan after each sync, decided here so it is tested:
//
//   - closes last week once: what was left of its amount goes to the first goal kept in
//     the account that isn't full (best practice: underspend goes somewhere, not into
//     next week's spending);
//   - fixes this week's amount on Monday, so it holds all week;
//   - on a payday, sets money aside for goals kept in the account, as the plan shares
//     the pay out (goals kept in a saver get theirs by transfer);
//   - 3 days after payday, raises an alert for a planned transfer that hasn't shown up.
//
// It does the first two only on the autopilot (a weekly floor set).

import { addDays } from "../dates/week.ts";
import { allocate, currentPayday, payLanded } from "./allocate.ts";
import { budgetView, mondayOf, savedNow, sharedOut, type BudgetData } from "./budget.ts";

export type EngineState = { lastWeekClosed: string | null; lastPaydayDone: string | null };

export type Apply = {
  week_amount?: { of: string; pence: number };
  closed_week?: string;
  payday_done?: string;
  payday_transfers?: { payday: string; transfers: { goal: number; name: string; pence: number }[] };
  set_aside?: { goal: number; pence: number }[];
  /** The real bill found for a regular cost (ongoing.ts), stored on the goal once. */
  goal_bills?: { goal: number; bill: number }[];
  /** Last week as it closed, for the weekly summary. */
  last_week?: {
    week: string;
    amount_pence: number;
    spent_pence: number;
    swept: { goal: number; name: string; pence: number }[];
  };
};

export type GoalAlert = {
  kind: "transfer-missing";
  dedupe: string;
  goal: number;
  detail: { name: string; pence: number; payday: string };
};

const FLEXIBLE = new Set(["groceries", "essentials", "discretionary"]);

export function decide(
  data: BudgetData,
  state: EngineState,
  moves: { goal: number; on: string; pence: number }[],
  today: string,
): { apply: Apply; alerts: GoalAlert[] } {
  const apply: Apply = {};
  const setAside = new Map<number, number>();
  const alerts: GoalAlert[] = [];
  const goals = (data.goals ?? []).filter((g) => g.status === "active" && sharedOut(g));
  const room = (id: number) => {
    const g = goals.find((x) => x.id === id)!;
    return Math.max(0, (g.targetPence ?? 0) - savedNow(g) - (setAside.get(id) ?? 0));
  };
  const add = (goal: number, pence: number) => {
    if (pence > 0) setAside.set(goal, (setAside.get(goal) ?? 0) + pence);
  };

  // The payday: set aside each goal kept in the account its share, and keep the moves
  // the plan asks for, as the owner is shown them, to check later that they arrived.
  // (Worked out again later, the plan would differ: by then the set-asides and the
  // moves themselves have filled the goals.)
  const payday = currentPayday(data, today);
  let transfers = data.paydayTransfers?.payday === payday ? data.paydayTransfers.transfers : null;
  if (payday && (!state.lastPaydayDone || state.lastPaydayDone < payday)) {
    const plan = allocate(data, payday);
    for (const s of plan?.shares ?? []) if (!s.transfer) add(s.id, s.pence);
    transfers = (plan?.shares ?? [])
      .filter((s) => s.transfer && s.pence > 0)
      .map((s) => ({ goal: s.id, name: s.name, pence: s.pence }));
    apply.payday_done = payday;
    apply.payday_transfers = { payday, transfers };
  }

  const monday = mondayOf(today);
  if (data.weeklyFloorPence !== null && data.weeklyFloorPence !== undefined) {
    // Last week: once, and only if its amount was fixed (otherwise there's nothing to measure against).
    const lastMonday = addDays(monday, -7);
    if (!state.lastWeekClosed || state.lastWeekClosed < lastMonday) {
      if (data.weekAmount?.of === lastMonday) {
        const spent =
          data.categories.filter((c) => FLEXIBLE.has(c.kind)).reduce((s, c) => s + c.spentLastWeek, 0) +
          data.unsortedLastWeek;
        let left = data.weekAmount.pence - spent;
        const swept: { goal: number; name: string; pence: number }[] = [];
        for (const g of goals.filter((x) => x.held === "account" && x.kind !== "debt")) {
          if (left <= 0) break;
          const give = Math.min(left, room(g.id));
          if (give <= 0) continue;
          add(g.id, give);
          swept.push({ goal: g.id, name: g.name, pence: give });
          left -= give;
        }
        apply.last_week = { week: lastMonday, amount_pence: data.weekAmount.pence, spent_pence: spent, swept };
      }
      apply.closed_week = lastMonday;
    }
    // This week's amount, with what's just been set aside counted.
    if (data.weekAmount?.of !== monday) {
      const after: BudgetData = {
        ...data,
        weekAmount: null,
        goals: (data.goals ?? []).map((g) => ({ ...g, savedPence: g.savedPence + (setAside.get(g.id) ?? 0) })),
      };
      const amount = budgetView(after, today).week.allowance;
      if (amount !== null) apply.week_amount = { of: monday, pence: amount };
    }
  }

  // The moves kept on payday, checked from 3 days after it: only for a goal whose payments
  // Money can see (it has a merchant).
  if (payday && transfers && today >= addDays(payday, 3)) {
    const since = payLanded(data, payday);
    for (const t of transfers) {
      if (!goals.find((x) => x.id === t.goal)?.merchantKey) continue;
      const moved = moves.filter((m) => m.goal === t.goal && m.on >= since).reduce((s, m) => s + m.pence, 0);
      if (moved < t.pence)
        alerts.push({
          kind: "transfer-missing",
          dedupe: `transfer-missing:${t.goal}:${payday}`,
          goal: t.goal,
          detail: { name: t.name, pence: t.pence - Math.max(0, moved), payday },
        });
    }
  }

  if (setAside.size) apply.set_aside = [...setAside].map(([goal, pence]) => ({ goal, pence }));
  return { apply, alerts };
}
