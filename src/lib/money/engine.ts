import "server-only";
import { addDays } from "../dates/week";
import { spotPay } from "./forecast";
import { adoptions, billAlerts, findBills, parseBill, parsePayments } from "./recurring";
import * as store from "./store";

// Money's autopilot. It runs after every good sync (the schedule, Refresh and Connect),
// so the budget keeps itself up to date without the owner opening Money: it finds the
// regular payments in the history, adopts the ones it is sure of as bills, marks the
// ones that have stopped as ended, raises an alert for a price rise or a missed bill,
// and sorts a pay that came in, so the forecast learns the real figure. Everything it
// decides is worked out by pure functions (recurring.ts, forecast.ts); this file only
// reads and writes, with the sync's key or the owner's session.

/** How far back it looks for bills: long enough to see a yearly one twice. */
const HISTORY_DAYS = 456;

type Row = Record<string, unknown>;
const rows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);

export async function runEngine(today: string, key?: string): Promise<{ adopted: number; alerts: number }> {
  const raw = ((await store.engineRead(addDays(today, -HISTORY_DAYS), key)) ?? {}) as Row;
  const payments = parsePayments(raw.payments);
  const bills = rows(raw.bills).map(parseBill);
  const found = findBills(payments, today);
  const adopt = adoptions(found, bills, today);
  const adopted = adopt.length ? await store.adoptBills(adopt, key) : 0;
  const alerts = billAlerts(found, bills, today);
  const raised = alerts.length ? await store.raiseAlerts(alerts, key) : 0;

  const settings = (raw.settings ?? {}) as Row;
  const pay = spotPay(
    rows(raw.incoming).map((t) => ({ id: Number(t.id), madeOn: String(t.made_on), pence: Number(t.pence) })),
    {
      paydayRule: typeof settings.payday_rule === "string" ? settings.payday_rule : "last-working-day",
      firstPayday: typeof settings.first_payday === "string" ? settings.first_payday : null,
      income: rows(raw.income).map((i) => ({
        fromOn: String(i.from_on),
        pence: Number(i.pence),
        grossYearPence: null,
      })),
    },
    today,
  );
  if (pay !== null) await store.markPay(pay, key);
  return { adopted, alerts: raised };
}
