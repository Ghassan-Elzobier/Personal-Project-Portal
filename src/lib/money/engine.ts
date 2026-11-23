import "server-only";
import { addDays } from "../dates/week";
import { decide } from "./autopilot";
import { mondayOf, monthStart, parseBudget } from "./budget";
import { spotPay } from "./forecast";
import { billsToStore, withOngoing } from "./ongoing";
import { adoptions, billAlerts, findBills, parseBill, parsePayments } from "./recurring";
import * as store from "./store";

// Money's autopilot. It runs after every good sync (the schedule, Refresh and Connect),
// so the budget keeps itself up to date without the owner opening Money:
//
//   - finds the regular payments in the history and adopts the ones it is sure of as
//     bills, marks the ones that have stopped as ended, and raises an alert for a price
//     rise or a missed bill (recurring.ts);
//   - sorts a pay that came in, so the forecast learns the real figure (forecast.ts);
//   - runs the plan: sets money aside on payday, closes last week (what was left goes
//     to a goal), fixes this week's amount, and checks a payday's transfers arrived
//     (autopilot.ts).
//
// Everything it decides is worked out by those pure functions; this file only reads and
// writes, with the sync's key or the owner's session.

/** How far back it looks for bills: long enough to see a yearly one twice. */
const HISTORY_DAYS = 456;

type Row = Record<string, unknown>;
const rows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function runEngine(today: string, key?: string): Promise<{ adopted: number; alerts: number }> {
  const raw = ((await store.engineRead(addDays(today, -HISTORY_DAYS), key)) ?? {}) as Row;
  const payments = parsePayments(raw.payments);
  const bills = rows(raw.bills).map(parseBill);
  const found = findBills(payments, today);
  const adopt = adoptions(found, bills, today);
  const adopted = adopt.length ? await store.adoptBills(adopt, key) : 0;
  const alerts = billAlerts(found, bills, today);
  let raised = alerts.length ? await store.raiseAlerts(alerts, key) : 0;

  const settings = (raw.settings ?? {}) as Row;
  const pay = spotPay(
    rows(raw.incoming).map((t) => ({ id: Number(t.id), madeOn: String(t.made_on), pence: Number(t.pence) })),
    {
      paydayRule: str(settings.payday_rule) ?? "last-working-day",
      firstPayday: str(settings.first_payday),
      income: rows(raw.income).map((i) => ({
        fromOn: String(i.from_on),
        pence: Number(i.pence),
        grossYearPence: null,
      })),
    },
    today,
  );
  if (pay !== null) await store.markPay(pay, key);

  // The plan, on the numbers as they now stand.
  const budget = ((await store.engineBudget(monthStart(today), mondayOf(today), key)) ?? {}) as Row;
  const s = (budget.settings ?? {}) as Row;
  // Regular costs count as bills from their start (ongoing.ts); a real bill found for one is stored on it.
  const data = withOngoing(parseBudget(budget), today);
  const { apply, alerts: goalAlerts } = decide(
    data,
    { lastWeekClosed: str(s.last_week_closed), lastPaydayDone: str(s.last_payday_done) },
    rows(budget.goal_moves).map((m) => ({ goal: Number(m.goal), on: String(m.on), pence: Number(m.pence) })),
    today,
  );
  const goalBills = billsToStore(data);
  if (goalBills.length) apply.goal_bills = goalBills;
  if (Object.keys(apply).length) await store.engineApply(apply, key);
  if (goalAlerts.length) raised += await store.raiseAlerts(goalAlerts, key);
  return { adopted, alerts: raised };
}
