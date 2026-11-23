// Prompts: Money speaks up only when something needs the owner, just before it
// matters, and names it. Best practice from the research: just-in-time alerts cut UK
// overdraft charges where generic low-balance warnings didn't (Grubb et al. 2025; FCA),
// and a reminder naming the goal or bill works, while repeats add nothing (Karlan et
// al.). So: at most two on Today, ranked, each about one event.
//
//   1. payday: the plan's moves to make
//   2. a bill of £20 or more going out today or tomorrow, and whether the balance covers it
//   3. the forecast dipping under the buffer (or below nothing) within 14 days
//   4. a payment to a merchant the owner chose to stop (watched)
//   5. a goal behind its pace on the next payday
//   6. a price rise, a missed bill, a transfer that hasn't arrived
//   7. over this week's amount

import { addDays } from "../dates/week.ts";
import { allocate, currentPayday } from "./allocate.ts";
import { mondayOf, type BudgetData, type BudgetView } from "./budget.ts";
import type { Forecast } from "./forecast.ts";
import { dueUntil } from "./recurring.ts";
import { alertText, pounds, type Alert } from "./state.ts";

export type Prompt = {
  key: string;
  text: string;
  tone: "info" | "warn";
  href: string;
  /** Set when the prompt is a stored alert, so it can be dismissed. */
  alertId?: number;
};

const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export const MAX_PROMPTS = 2;

export function prompts(
  data: BudgetData,
  view: BudgetView,
  f: Forecast | null,
  alerts: Alert[],
  today: string,
): Prompt[] {
  const out: Prompt[] = [];

  const payday = currentPayday(data, today);
  if (payday && today <= addDays(payday, 2)) {
    const moves = allocate(data, payday)?.shares.filter((s) => s.transfer && s.pence > 0) ?? [];
    if (moves.length)
      out.push({
        key: `payday:${payday}`,
        tone: "info",
        href: "/life/money#goals-title",
        text: `Payday: ${moves
          .map((s) =>
            s.kind === "debt" ? `pay ${pounds(s.pence)} extra off ${s.name}` : `move ${pounds(s.pence)} to ${s.name}`,
          )
          .join(", ")}.`,
      });
  }

  const tomorrow = addDays(today, 1);
  // Only bills Money found: a regular cost's made-up bill (negative id) has no real debit to warn of.
  for (const b of (data.bills ?? []).filter((x) => x.id > 0 && x.status === "active" && x.expectedPence >= 2_000)) {
    const due = dueUntil(b, today, tomorrow)[0];
    if (!due) continue;
    const short = b.expectedPence - (data.balancePence ?? 0);
    out.push({
      key: `bill:${b.id}:${due}`,
      tone: short > 0 ? "warn" : "info",
      href: "/life/money#bills-title",
      text:
        `${b.name ?? "A bill"}: ${b.variable ? "about " : ""}${pounds(b.expectedPence)} goes out ${due <= today ? "today" : "tomorrow"}. ` +
        (short > 0 ? `Your balance is ${pounds(short)} short.` : "Your balance covers it."),
    });
  }

  if (f) {
    const bufferOn = (d: string) => (!data.bufferFrom || data.bufferFrom <= d ? data.bufferPence : 0);
    const low = f.points.find((p) => p.day <= addDays(today, 14) && p.pence < bufferOn(p.day));
    if (low)
      out.push({
        key: `dip:${low.day}`,
        tone: "warn",
        href: "/life/money#ahead-title",
        text: `Your balance is heading for ${pounds(low.pence)} on ${day(low.day)}, ${low.pence < 0 ? "overdrawn" : "under your buffer"}. Spend less this week, or move a planned purchase.`,
      });
  }

  const stored = (a: Alert): Prompt => ({
    key: `alert:${a.id}`,
    alertId: a.id,
    tone: "warn",
    href: "/life/money",
    text: alertText(a),
  });
  out.push(...alerts.filter((a) => a.kind === "watched").map(stored));

  const next = allocate(data, view.payday);
  const behind = next?.shares.find((s) => s.slipped && s.need > 0);
  if (behind)
    out.push({
      key: `behind:${view.payday}:${behind.id}`,
      tone: "warn",
      href: "/life/money#goals-title",
      text: `${behind.name} is behind its pace: on ${day(view.payday)} it gets ${pounds(behind.pence)} of the ${pounds(behind.need)} it needs.`,
    });

  out.push(...alerts.filter((a) => a.kind !== "watched").map(stored));

  if (view.week.left !== null && view.week.left < 0)
    out.push({
      key: `over:${mondayOf(today)}`,
      tone: "warn",
      href: "/life/money#week-title",
      text: `${pounds(-view.week.left)} over this week's amount. ${view.week.auto ? "The weeks to payday share it." : "It comes off next week."}`,
    });

  return out.slice(0, MAX_PROMPTS);
}
