import "server-only";
import { addDays } from "../dates/week";
import { adoptions, billAlerts, findBills, parseBill, parsePayments } from "./recurring";
import * as store from "./store";

// Money's autopilot. It runs after every good sync (the schedule, Refresh and Connect),
// so the budget keeps itself up to date without the owner opening Money: it finds the
// regular payments in the history, adopts the ones it is sure of as bills, marks the
// ones that have stopped as ended, and raises an alert for a price rise or a missed
// bill. Everything it decides is worked out by pure functions (recurring.ts); this file
// only reads and writes, with the sync's key or the owner's session.

/** How far back it looks for bills: long enough to see a yearly one twice. */
const HISTORY_DAYS = 456;

export async function runEngine(today: string, key?: string): Promise<{ adopted: number; alerts: number }> {
  const raw = ((await store.engineRead(addDays(today, -HISTORY_DAYS), key)) ?? {}) as {
    payments?: unknown;
    bills?: unknown;
  };
  const payments = parsePayments(raw.payments);
  const bills = (Array.isArray(raw.bills) ? (raw.bills as Record<string, unknown>[]) : []).map(parseBill);
  const found = findBills(payments, today);
  const rows = adoptions(found, bills, today);
  const adopted = rows.length ? await store.adoptBills(rows, key) : 0;
  const alerts = billAlerts(found, bills, today);
  const raised = alerts.length ? await store.raiseAlerts(alerts, key) : 0;
  return { adopted, alerts: raised };
}
