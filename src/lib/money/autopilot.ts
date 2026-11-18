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
import { allocate, currentPayday } from "./allocate.ts";
import { budgetView, mondayOf, savedNow, type BudgetData } from "./budget.ts";

export type EngineState = { lastWeekClosed: string | null; lastPaydayDone: string | null };

export type Apply = {
  week_amount?: { of: string; pence: number };
  closed_week?: string;
  payday_done?: string;
  set_aside?: { goal: number; pence: number }[];
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
  const goals = (data.goals ?? []).filter((g) => g.status === "active");
  const room = (id: number) => {
    const g = goals.find((x) => x.id === id)!;
    return Math.max(0, (g.targetPence ?? 0) - savedNow(g) - (setAside.get(id) ?? 0));
  };
  const add = (goal: number, pence: number) => {
    if (pence > 0) setAside.set(goal, (setAside.get(goal) ?? 0) + pence);
  };

  // The payday: set aside each goal kept in the account its share.
  const payday = currentPayday(data, today);
  if (payday && (!state.lastPaydayDone || state.lastPaydayDone < payday)) {
    const plan = allocate(data, payday);
    for (const s of plan?.shares ?? []) if (!s.transfer) add(s.id, s.pence);
    apply.payday_done = payday;
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
        for (const g of goals.filter((x) => x.held === "account" && x.kind !== "debt")) {
          if (left <= 0) break;
          const give = Math.min(left, room(g.id));
          add(g.id, give);
          left -= give;
        }
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

  // Transfers due on the payday that started this cycle, checked from 3 days after it.
  if (payday && today >= addDays(payday, 3)) {
    const plan = allocate(data, payday);
    for (const s of plan?.shares ?? []) {
      const g = goals.find((x) => x.id === s.id);
      if (!s.transfer || s.pence <= 0 || !g?.merchantKey) continue;
      const moved = moves.filter((m) => m.goal === s.id && m.on >= payday).reduce((t, m) => t + m.pence, 0);
      if (moved < s.pence)
        alerts.push({
          kind: "transfer-missing",
          dedupe: `transfer-missing:${s.id}:${payday}`,
          goal: s.id,
          detail: { name: s.name, pence: s.pence - Math.max(0, moved), payday },
        });
    }
  }

  if (setAside.size) apply.set_aside = [...setAside].map(([goal, pence]) => ({ goal, pence }));
  return { apply, alerts };
}
