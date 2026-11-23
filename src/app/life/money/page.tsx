import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { moneySyncKey, timeZone } from "@/lib/config/env";
import { now } from "@/lib/dates/clock";
import { addDays, dateIn } from "@/lib/dates/week";
import { allocate, suggestGoals } from "@/lib/money/allocate";
import { nextPayday, savedNow, type BudgetData, type BudgetView, type Goal } from "@/lib/money/budget";
import type { Forecast } from "@/lib/money/forecast";
import { weekSummary, type WeekSummary } from "@/lib/money/summary";
import { loadLife } from "@/lib/life/load";
import { loadMoney } from "@/lib/money/load";
import { plannedShop } from "@/lib/portal/money";
import { lunchflowReady } from "@/lib/money/lunchflow";
import { nextDue, yearlyPence, type Bill } from "@/lib/money/recurring";
import { ago, alertText, feedNote, monthView, pounds, type MoneyState, type Txn } from "@/lib/money/state";
import { Empty, ErrorNote } from "@/components/ui";
import { ActionButton } from "../kit";
import { LifeHeader } from "../parts";
import {
  cancelPlanned,
  disconnectBank,
  dismissAlert,
  forgetBank,
  refreshBank,
  registerSyncKey,
  addSuggestedGoals,
  moveGoal,
  removeGoal,
  removeIncome,
  setBill,
  setClaudeAccess,
} from "./actions";
import { ForecastChart } from "../chart";
import { ConnectBank } from "./connect";
import { GoalForm } from "./goal-form";
import { PayForm } from "./pay-form";
import { PaymentList } from "./payments";
import { PlanForm } from "./plan-form";
import { PlannedForm } from "./planned-form";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

const INTRO = "Your bank balance and payments, read from Lunch Flow and kept fresh through the day.";

const ACCESS: { level: MoneyState["claudeAccess"]; name: string; text: string }[] = [
  { level: "off", name: "Off", text: "Claude can't see Money at all." },
  {
    level: "summary",
    name: "Summary",
    text: 'Your balance and this month\'s totals, and "can I afford it?". Never a single payment.',
  },
  { level: "plan", name: "Plan", text: "Also saves a purchase you've planned together in a chat." },
  {
    level: "setup",
    name: "Setup",
    text: "Also reads a year of totals by category and merchant, and sets budgets, rules and watched merchants. For setting up; turn it down after.",
  },
];

export default async function MoneyPage() {
  const [, loaded, life] = await Promise.all([requireOwner(), loadMoney(), loadLife()]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Money">{INTRO}</LifeHeader>
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const note = feedNote(s, now());
  const connected = s.connection !== null && s.connection.status !== "off";

  return (
    <div className="space-y-6">
      <LifeHeader title="Money">{INTRO}</LifeHeader>
      {note && (
        <p
          role={note.tone === "error" ? "alert" : "status"}
          className={`rounded-xl p-4 text-sm ring-1 ${note.tone === "error" ? "bg-coral/10 text-coral ring-coral/30" : "bg-sand/10 text-sand ring-sand/30"}`}
        >
          {note.text}
        </p>
      )}
      {s.alerts.length > 0 && <Alerts s={s} />}
      {connected && (
        <ThisWeek view={loaded.view} today={loaded.today} shop={life.state ? plannedShop(life.state) : 0} />
      )}
      {connected && (
        <Summary s={weekSummary(loaded.budget, loaded.view, loaded.forecast, loaded.today)} today={loaded.today} />
      )}
      {connected && loaded.forecast && <Ahead f={loaded.forecast} budget={loaded.budget} />}
      {connected && <Goals budget={loaded.budget} today={loaded.today} />}
      {connected && <PlannedPurchases budget={loaded.budget} today={loaded.today} />}
      {connected && <Bills bills={loaded.budget.bills ?? []} today={loaded.today} />}
      {connected ? <Balances s={s} /> : <Connect again={s.connection?.status === "off"} />}
      {s.accounts.length > 0 && <ThisMonth s={s} />}
      {s.accounts.length > 0 && <Payments s={s} txns={loaded.txns} />}
      {s.connection && <Pay budget={loaded.budget} payday={loaded.view.payday} />}
      {s.connection && <Plan budget={loaded.budget} />}
      {s.connection && <Claude s={s} />}
      {s.connection && <Connection connected={connected} s={s} />}
    </div>
  );
}

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** This week's amount on top, then how the weeks to payday look, and where the money goes. */
function ThisWeek({ view: v, today, shop }: { view: BudgetView; today: string; shop: number }) {
  const w = v.week;
  return (
    <section aria-labelledby="week-title" className="space-y-3 card-life">
      <h2 id="week-title" className="text-lg font-semibold">
        This week
      </h2>
      {w.left === null ? (
        <p className="text-sm text-body">
          Set the amount you live on each week, under Your plan below, to see what&apos;s left.
        </p>
      ) : (
        <div>
          <p className={`text-3xl font-bold tabular-nums ${w.left < 0 ? "text-coral" : "text-bright"}`}>
            {w.left < 0 ? `${pounds(-w.left)} over` : `${pounds(w.left)} left`}
          </p>
          <p className="text-sm text-muted tabular-nums">
            of {pounds(w.allowance!)}: {pounds(w.spent)} spent
            {w.carry > 0 && `, ${pounds(w.carry)} over last week`}
            {w.spread > 0 && `, ${pounds(w.spread)} planned`}. Resets on Monday.
          </p>
          {w.auto && w.floor !== null && w.target !== null && (
            <p className="mt-1 text-xs text-muted tabular-nums">
              Set from your plan: what&apos;s safe to payday, between your {pounds(w.floor)} and {pounds(w.target)} a
              week.
            </p>
          )}
          {shop > 0 && w.left > 0 && (
            <p className="mt-1 text-sm text-body tabular-nums">
              {shop >= w.left
                ? `The shops before Monday need ${pounds(shop)}: more than is left.`
                : `${pounds(shop)} of it for the shops before Monday, ${pounds(w.left - shop)} for the rest.`}
            </p>
          )}
        </div>
      )}
      {v.safe !== null && (
        <p
          className={`rounded-xl p-3 text-sm ${v.onTrack === false ? "bg-coral/10 text-coral" : "bg-white/5 text-body"}`}
        >
          {v.perWeek !== null && v.perWeek > 0
            ? `Enough for ${pounds(v.perWeek)} a week until payday on ${longDay(v.payday)}`
            : `Nothing spare until payday on ${longDay(v.payday)}`}
          {w.allowance !== null &&
            (v.onTrack ? `: on track for your ${pounds(w.allowance)}.` : `, less than your ${pounds(w.allowance)}.`)}
        </p>
      )}
      {v.safe !== null && v.balance !== null && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Where it goes</summary>
          <dl className="mt-2 space-y-1 tabular-nums">
            <div className="flex justify-between gap-3">
              <dt>Balance</dt>
              <dd>{pounds(v.balance)}</dd>
            </div>
            {v.stillToPay.map((c) => (
              <div key={c.key} className="flex justify-between gap-3 text-muted">
                <dt className="min-w-0 truncate">{c.on ? `${c.name}, ${longDay(c.on)}` : `${c.name}, still to pay`}</dt>
                <dd>−{pounds(c.pence)}</dd>
              </div>
            ))}
            {v.plannedBefore > 0 && (
              <div className="flex justify-between gap-3 text-muted">
                <dt>Planned purchases</dt>
                <dd>−{pounds(v.plannedBefore)}</dd>
              </div>
            )}
            {v.buffer > 0 && (
              <div className="flex justify-between gap-3 text-muted">
                <dt>Buffer, always kept</dt>
                <dd>−{pounds(v.buffer)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-white/10 pt-1 font-medium">
              <dt>Safe to spend</dt>
              <dd>{pounds(v.safe)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-muted">
              <dt>
                Over {v.daysToPayday} {v.daysToPayday === 1 ? "day" : "days"} to {longDay(v.payday)}
              </dt>
              <dd>{pounds(Math.floor(v.safe / Math.max(1, v.daysToPayday)))} a day</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-faint">
            Bills Money found count on their own days up to payday. Any other bill or savings budget counts for each
            month up to payday, less what has gone out this month. Today is {longDay(today)}.
          </p>
        </details>
      )}
    </section>
  );
}

const FUNDING: Record<string, (weeks: number) => string> = {
  allowance: () => "from that week's amount",
  spread: (weeks) => `spread over ${weeks} weeks`,
  safe: () => "from what's safe before payday",
};

/** Purchases planned (by you or Claude) and not paid yet: the week and payday count them already. */
function PlannedPurchases({ budget, today }: { budget: BudgetData; today: string }) {
  const planned = budget.planned ?? [];
  return (
    <section aria-labelledby="planned-title" className="space-y-3 card-life">
      <h2 id="planned-title" className="font-semibold">
        Planned purchases
      </h2>
      {planned.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing planned. Plan one here, or ask Claude &quot;can I afford it?&quot; and it saves the way you pick.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-xl bg-white/5">
          {planned.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm">{p.name}</span>
                <span className="block text-xs text-body tabular-nums">
                  {pounds(p.pence)} · {longDay(p.dueOn)}
                </span>
                <span className="block text-xs text-muted">
                  {(FUNDING[p.funding] ?? FUNDING.safe)(p.weeks)}
                  {p.addedBy === "claude" && " · planned with Claude"}
                </span>
              </span>
              <ActionButton
                action={cancelPlanned.bind(null, p.id ?? 0)}
                className="btn-soft shrink-0 px-3 py-1.5 text-xs"
                confirm={`Cancel ${p.name}?`}
                done="Cancelled."
                label={`Cancel ${p.name}`}
              >
                Cancel
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <PlannedForm today={today} />
      <p className="text-xs text-faint">
        Paid within 2 weeks of its day, a plan is matched to the payment and stops counting.
      </p>
    </section>
  );
}

const PER: Record<Bill["cadence"], string> = { weekly: "a week", monthly: "a month", yearly: "a year" };
/** "8 Dec": short enough for a bill's line at 360 px. */
const dayMonth = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The regular payments Money found by itself, next one first. One that isn't a bill can be ignored. */
function Bills({ bills, today }: { bills: Bill[]; today: string }) {
  const active = bills
    .filter((b) => b.status === "active")
    .map((b) => ({ b, due: nextDue(b, today) }))
    .sort((x, y) => x.due.localeCompare(y.due));
  const ignored = bills.filter((b) => b.status === "ignored");
  const yearly = active.reduce((s, { b }) => s + yearlyPence(b), 0);
  const recent = addDays(today, -14);
  return (
    <section aria-labelledby="bills-title" className="space-y-3 card-life">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="bills-title" className="font-semibold">
          Bills
        </h2>
        {active.length > 0 && (
          <p className="text-sm text-muted tabular-nums">
            {pounds(Math.round(yearly / 12))} a month · {pounds(yearly)} a year
          </p>
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-muted">
          None found yet. After each sync, Money looks for payments that repeat on a steady day, three times or more,
          and lists them here.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-xl bg-white/5">
          {active.map(({ b, due }) => (
            <li key={b.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm">{b.name}</span>
                <span className="block text-xs text-body tabular-nums">
                  {b.variable && "about "}
                  {pounds(b.expectedPence)} {PER[b.cadence]} ·{" "}
                  {due < today ? `due ${dayMonth(due)}, late` : `next ${dayMonth(due)}`}
                </span>
                <span className="block text-xs text-muted">
                  {b.lastPaidOn ? `Paid ${dayMonth(b.lastPaidOn)}` : "Not paid yet"}
                  {b.addedBy === "engine" && b.createdAt.slice(0, 10) >= recent && " · found for you"}
                </span>
              </span>
              <ActionButton
                action={setBill.bind(null, b.id, "ignored")}
                className="btn-soft shrink-0 px-3 py-1.5 text-xs"
                done="Ignored."
                label={`Ignore ${b.name}`}
              >
                Ignore
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {ignored.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Ignored ({ignored.length})</summary>
          <ul className="mt-2 divide-y divide-white/5 rounded-xl bg-white/5">
            {ignored.map((b) => (
              <li key={b.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0 truncate text-muted">{b.name}</span>
                <ActionButton
                  action={setBill.bind(null, b.id, "active")}
                  className="btn-soft shrink-0 px-3 py-1.5 text-xs"
                  done="Counting it again."
                  label={`Take back ${b.name}`}
                >
                  Take back
                </ActionButton>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-faint">
        Safe-to-spend counts each bill on its day, and a bill&apos;s payment isn&apos;t this week&apos;s spending.
        Ignore one that isn&apos;t a bill and it won&apos;t be found again.
      </p>
    </section>
  );
}

/** The week in short, written with no input: last week, what was unusual, the week ahead, the goals. */
function Summary({ s, today }: { s: WeekSummary; today: string }) {
  if (s.spent === 0 && s.next7.length === 0 && s.goals.length === 0) return null;
  const diff = s.amount === null ? null : s.amount - s.spent;
  return (
    <section aria-labelledby="summary-title" className="space-y-2 card-life">
      <h2 id="summary-title" className="font-semibold">
        Your week in short
      </h2>
      <p className="text-sm tabular-nums">
        Last week, from {dayMonth(s.week)}: {pounds(s.spent)}
        {s.amount !== null && ` of ${pounds(s.amount)}`}
        {diff !== null && (diff >= 0 ? `, ${pounds(diff)} under` : `, ${pounds(-diff)} over`)}.
        {s.swept.length > 0 && ` ${s.swept.map((x) => `${pounds(x.pence)} went to ${x.name}`).join(", ")}.`}
      </p>
      {s.unusual.length > 0 && (
        <p className="text-sm text-body tabular-nums">
          Off your usual week:{" "}
          {s.unusual.map((u) => `${u.name} ${pounds(u.spent)} (usually ${pounds(u.usual)})`).join(" · ")}.
        </p>
      )}
      {s.next7.length > 0 && (
        <p className="text-sm text-muted tabular-nums">
          Next 7 days:{" "}
          {s.next7
            .map(
              (e) =>
                `${e.day === addDays(today, 1) ? "tomorrow" : dayMonth(e.day)} ${e.name} ${pounds(Math.abs(e.pence))}`,
            )
            .join(" · ")}
        </p>
      )}
      {s.goals.length > 0 && (
        <p className="text-sm text-muted">
          Goals: {s.goals.map((g) => `${g.name} ${g.onPace ? "on pace" : "behind"}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

/** The next 13 weeks: the balance day by day, its lowest point, the paydays and each Monday's checkpoint. */
function Ahead({ f, budget }: { f: Forecast; budget: BudgetData }) {
  const bufferOn = (d: string) => (!budget.bufferFrom || budget.bufferFrom <= d ? budget.bufferPence : 0);
  const low = f.lowest;
  const under = low.pence < bufferOn(low.day);
  const unplanned = f.paydays.some((p) => p.pence === 0);
  return (
    <section aria-labelledby="ahead-title" className="space-y-3 card-life">
      <h2 id="ahead-title" className="font-semibold">
        The next 13 weeks
      </h2>
      <ForecastChart
        points={f.points}
        buffer={budget.bufferPence}
        bufferFrom={budget.bufferFrom}
        lowest={low}
        paydays={f.paydays.map((p) => p.day)}
        label={`Your balance day by day for 13 weeks. Lowest ${pounds(low.pence)} on ${longDay(low.day)}.`}
      />
      <p className={`text-sm tabular-nums ${under ? "text-coral" : "text-body"}`}>
        Lowest: {pounds(low.pence)} on {longDay(low.day)}
        {!under ? "." : low.pence < 0 ? ", overdrawn." : ", under your buffer."}
      </p>
      {f.paydays.length > 0 && (
        <p className="text-sm text-muted tabular-nums">
          Pay: {f.paydays.map((p) => `${dayMonth(p.day)} ${p.pence > 0 ? pounds(p.pence) : "not planned"}`).join(" · ")}
        </p>
      )}
      {unplanned && <p className="text-sm text-muted">Add your pay under Your pay below to see it in the forecast.</p>}
      {f.checkpoints.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Monday checkpoints</summary>
          <dl className="mt-2 space-y-1 tabular-nums">
            {f.checkpoints.map((c) => (
              <div key={c.day} className="flex justify-between gap-3">
                <dt>{longDay(c.day)}</dt>
                <dd className={c.pence < bufferOn(c.day) ? "text-coral" : ""}>{pounds(c.pence)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-faint">
            The balance each week should start with if the plan holds. Above it, you&apos;re ahead.
          </p>
        </details>
      )}
    </section>
  );
}

/** A thin bar of how far along something is: spending against a budget, a goal's savings. */
function Bar({ share, over = false }: { share: number; over?: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
      <div
        className={`h-full rounded-full ${over ? "bg-coral" : "bg-mint"}`}
        style={{ width: `${Math.min(100, Math.round(share * 100))}%` }}
      />
    </div>
  );
}

const KIND_NAME: Record<Goal["kind"], string> = { saving: "Saving", sinking: "Put by", debt: "Debt" };
const monthYear = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * What the money is for, in order, and how the next payday shares the pay out: each
 * goal's progress and pace, then what to move where on payday.
 */
function Goals({ budget, today }: { budget: BudgetData; today: string }) {
  const goals = (budget.goals ?? []).filter((g) => g.status === "active");
  const payday = nextPayday(today, budget.paydayRule, budget.firstPayday);
  const plan = allocate(budget, payday);
  const share = (id: number) => plan?.shares.find((s) => s.id === id);
  const suggested = suggestGoals(budget, today);
  const moves = plan?.shares.filter((s) => s.pence > 0) ?? [];
  return (
    <section aria-labelledby="goals-title" className="space-y-3 card-life">
      <h2 id="goals-title" className="font-semibold">
        Goals
      </h2>
      <p className="text-sm text-muted">
        In this order, each payday pays the bills, keeps your least for each week, gives each goal its pace, then raises
        the week to your amount; anything left goes to the first goal.
      </p>
      {budget.bufferPence > 0 && (
        <p className="rounded-xl bg-white/5 px-3 py-2.5 text-sm tabular-nums">
          Buffer: {pounds(budget.bufferPence)} kept in the account
          {budget.bufferFrom && budget.bufferFrom > today ? ` from ${dayMonth(budget.bufferFrom)}` : ""}
        </p>
      )}
      {goals.length > 0 && (
        <ol className="divide-y divide-white/5 rounded-xl bg-white/5">
          {goals.map((g, i) => {
            const s = share(g.id);
            const now = savedNow(g);
            const target = g.targetPence ?? 0;
            return (
              <li key={g.id} className="space-y-1.5 px-3 py-2.5">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{g.name}</span>
                    <span className="block text-xs text-body tabular-nums">
                      {g.kind === "debt" ? `${pounds(now)} left` : `${pounds(now)} of ${pounds(target)}`} ·{" "}
                      {KIND_NAME[g.kind]}
                      {g.kind === "debt" ? "" : g.held === "account" ? ", in the account" : ", in a saver"}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <ActionButton
                      action={moveGoal.bind(null, g.id, -1)}
                      className="btn-soft px-2 py-1 text-xs"
                      disabled={i === 0}
                      label={`Move ${g.name} up`}
                    >
                      ↑
                    </ActionButton>
                    <ActionButton
                      action={moveGoal.bind(null, g.id, 1)}
                      className="btn-soft px-2 py-1 text-xs"
                      disabled={i === goals.length - 1}
                      label={`Move ${g.name} down`}
                    >
                      ↓
                    </ActionButton>
                    <ActionButton
                      action={removeGoal.bind(null, g.id)}
                      className="btn-soft px-2 py-1 text-xs"
                      confirm={`Remove ${g.name}?`}
                      done="Removed."
                      label={`Remove ${g.name}`}
                    >
                      ✕
                    </ActionButton>
                  </span>
                </div>
                {g.kind !== "debt" && target > 0 && <Bar share={now / target} />}
                {s && (
                  <p className={`text-xs tabular-nums ${s.slipped ? "text-coral" : "text-muted"}`}>
                    {s.pence > 0 ? `${pounds(s.pence)} on ${dayMonth(payday)}` : `Nothing on ${dayMonth(payday)}`}
                    {s.finish && ` · there by ${monthYear(s.finish)}`}
                    {s.slipped && " · behind its pace"}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {suggested.length > 0 && (
        <div className="space-y-2 rounded-xl bg-white/5 p-3 text-sm">
          <p className="font-medium">Suggested from your bills and spending</p>
          <ul className="space-y-1 text-body">
            {suggested.map((g) => (
              <li key={g.name} className="tabular-nums">
                {g.name}: {pounds(g.targetPence)}
                {g.dueOn ? ` by ${dayMonth(g.dueOn)}` : ""}, {g.held === "account" ? "in the account" : "in a saver"}
              </li>
            ))}
          </ul>
          <ActionButton
            action={addSuggestedGoals}
            className="btn-soft px-3 py-1.5 text-xs"
            done="Added. Change the order any time."
          >
            Add {suggested.length === 1 ? "it" : "these"}
          </ActionButton>
        </div>
      )}
      {plan === null ? (
        <p className="text-sm text-muted">Add your pay below to see how each payday is shared out.</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="font-medium">On payday, {longDay(payday)}</p>
          {plan.short && (
            <p className="text-coral">
              The pay doesn&apos;t cover the bills and your least each week: lower the least, or a bill.
            </p>
          )}
          <ul className="space-y-0.5 text-body tabular-nums">
            {moves
              .filter((s) => s.transfer)
              .map((s) => (
                <li key={s.id}>
                  {s.kind === "debt"
                    ? `Pay ${pounds(s.pence)} extra off ${s.name}`
                    : `Move ${pounds(s.pence)} to ${s.name}`}
                </li>
              ))}
            {moves
              .filter((s) => !s.transfer)
              .map((s) => (
                <li key={s.id}>
                  {pounds(s.pence)} set aside for {s.name}, in the account
                </li>
              ))}
            <li>
              {pounds(plan.weekly)} a week to live on until {dayMonth(plan.to)}
            </li>
          </ul>
          {moves.some((s) => s.transfer) && (
            <p className="text-xs text-faint">
              Set the moves up once as standing orders for the day after payday: Money checks they arrive.
            </p>
          )}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Add a goal</summary>
        <div className="mt-3">
          <GoalForm key={goals.length} />
        </div>
      </details>
    </section>
  );
}

/** Pay in pounds: take-home on each payday from a day on, and the latest pay that came in. */
function Pay({ budget, payday }: { budget: BudgetData; payday: string }) {
  const steps = budget.income ?? [];
  return (
    <section aria-labelledby="pay-title" className="space-y-3 card-life">
      <h2 id="pay-title" className="font-semibold">
        Your pay
      </h2>
      {steps.length === 0 ? (
        <p className="text-sm text-muted">
          No pay planned yet. Add the take-home from your next payday, or the salary, and the forecast puts it on each
          payday. When a pay comes in, Money spots it and uses the real figure.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-xl bg-white/5">
          {steps.map((s) => (
            <li key={s.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm tabular-nums">
                  {pounds(s.pence)} a month from {dayMonth(s.fromOn)}
                </span>
                {s.grossYearPence !== null && (
                  <span className="block text-xs text-muted tabular-nums">
                    From a salary of {pounds(s.grossYearPence)} a year
                  </span>
                )}
              </span>
              <ActionButton
                action={removeIncome.bind(null, s.id ?? 0)}
                className="btn-soft shrink-0 px-3 py-1.5 text-xs"
                done="Removed."
                label={`Remove the pay from ${dayMonth(s.fromOn)}`}
              >
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {budget.lastPay && (
        <p className="text-sm text-body tabular-nums">
          Last pay: {pounds(budget.lastPay.pence)} on {dayMonth(budget.lastPay.day)}. Later paydays use it until a step
          says otherwise.
        </p>
      )}
      <PayForm key={steps.map((s) => `${s.fromOn}:${s.pence}`).join(",")} fromOn={payday} />
    </section>
  );
}

function Plan({ budget }: { budget: BudgetData }) {
  const values = {
    allowance: budget.allowancePence === null ? "" : String(budget.allowancePence / 100),
    floor: budget.weeklyFloorPence == null ? "" : String(budget.weeklyFloorPence / 100),
    buffer: budget.bufferPence ? String(budget.bufferPence / 100) : "",
    bufferFrom: budget.bufferFrom ?? "",
    firstPayday: budget.firstPayday ?? "",
    paydayRule: budget.paydayRule,
  };
  return (
    <section aria-labelledby="plan-title" className="space-y-3 card-life">
      <h2 id="plan-title" className="font-semibold">
        Your plan
      </h2>
      <p className="text-sm text-muted">
        Monthly budgets for each category are set with Claude, or below for the weekly amount, the buffer and payday.
      </p>
      {/* Keyed to what's saved, so the form always starts from the saved plan. */}
      <PlanForm key={JSON.stringify(values)} {...values} />
    </section>
  );
}

function Alerts({ s }: { s: MoneyState }) {
  return (
    <section aria-label="Alerts" className="space-y-2">
      {s.alerts.map((a) => (
        <div
          key={a.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand/10 p-3 text-sm text-sand ring-1 ring-sand/30"
        >
          <p className="min-w-0">{alertText(a)}</p>
          <ActionButton
            action={dismissAlert.bind(null, a.id)}
            className="btn-soft px-3 py-1.5 text-xs"
            done="Dismissed."
          >
            Dismiss
          </ActionButton>
        </div>
      ))}
    </section>
  );
}

function ThisMonth({ s }: { s: MoneyState }) {
  const m = monthView(s.categories);
  const month = s.month
    ? new Date(`${s.month}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
    : "This month";
  return (
    <section aria-labelledby="month-title" className="space-y-4 card-life">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="month-title" className="text-lg font-semibold">
          {month} so far
        </h2>
        <p className="text-sm text-muted tabular-nums">
          {pounds(m.out)} out{m.budget > 0 && ` of ${pounds(m.budget)} budgeted`}
        </p>
      </div>
      {m.rows.length === 0 ? (
        <Empty>Nothing spent yet this month.</Empty>
      ) : (
        <ul className="space-y-3">
          {m.rows.map((c) => (
            <li key={c.id} className="space-y-1">
              <p className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{c.name}</span>
                <span className={`shrink-0 tabular-nums ${c.over ? "text-coral" : "text-body"}`}>
                  {pounds(c.outPence)}
                  {c.budgetPence !== null && <span className="text-muted"> / {pounds(c.budgetPence)}</span>}
                </span>
              </p>
              {c.share !== null && <Bar share={c.share} over={c.over} />}
            </li>
          ))}
        </ul>
      )}
      {s.unsorted > 0 && (
        <p className="text-xs text-muted">
          {s.unsorted} {s.unsorted === 1 ? "payment" : "payments"} this month not sorted yet: tap one below to sort it.
        </p>
      )}
    </section>
  );
}

function Payments({ s, txns }: { s: MoneyState; txns: Txn[] }) {
  return (
    <section aria-labelledby="payments-title" className="space-y-4 card-life">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="payments-title" className="text-lg font-semibold">
          Payments
        </h2>
        <Link href="/life/money/upload" className="text-sm text-mint underline">
          Add a statement
        </Link>
      </div>
      {txns.length === 0 ? (
        <Empty>No payments yet. They come in with the next sync, or from a statement.</Empty>
      ) : (
        <>
          <PaymentList txns={txns} categories={s.categories} today={dateIn(now(), timeZone())} />
          <p className="text-xs text-faint">The last 60 days. Tap a payment to sort it.</p>
        </>
      )}
    </section>
  );
}

function Claude({ s }: { s: MoneyState }) {
  return (
    <section aria-labelledby="claude-title" className="space-y-3 card-life">
      <h2 id="claude-title" className="font-semibold">
        What Claude can do with Money
      </h2>
      <p className="text-sm text-muted">
        Only you can change this, here. Whatever Claude reads becomes part of that chat.
      </p>
      <ul className="space-y-2">
        {ACCESS.map((a) => (
          <li key={a.level}>
            <ActionButton
              action={setClaudeAccess.bind(null, a.level)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-xl p-3 text-left text-sm ring-1 ${s.claudeAccess === a.level ? "bg-mint/10 ring-mint/40" : "bg-white/5 ring-white/10 hover:bg-white/10"}`}
              done={`Claude's access: ${a.name}.`}
              label={`${a.name}${s.claudeAccess === a.level ? " (current)" : ""}`}
            >
              <span className={`font-medium ${s.claudeAccess === a.level ? "text-mint" : ""}`}>{a.name}</span>
              <span className="text-xs text-muted">{a.text}</span>
            </ActionButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Balances({ s }: { s: MoneyState }) {
  const updated = s.lastOk ? `Updated ${ago(s.lastOk, now())}` : "Not synced yet";
  return (
    <section aria-labelledby="balance-title" className="space-y-4 card-life">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="balance-title" className="text-lg font-semibold">
          Balance
        </h2>
        <p className="flex items-center gap-3 text-sm text-muted">
          <span>{updated}</span>
          <ActionButton action={refreshBank} className="btn-soft px-3 py-1.5 text-xs" done="Up to date.">
            Refresh
          </ActionButton>
        </p>
      </div>
      <ul className="space-y-3">
        {s.accounts.map((a) => (
          <li key={a.id} className="rounded-xl bg-white/5 p-4">
            <p className="text-sm text-body">
              {a.name}
              {a.last4 && <span className="text-muted tabular-nums"> ••{a.last4}</span>}
            </p>
            <p className="text-3xl font-bold text-bright tabular-nums">
              {a.balance ? pounds(a.balance.pence, a.currency) : "—"}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint">
        Lunch Flow reads your bank a few times a day; Refresh fetches its latest copy. Read only: nothing here can move
        money.
      </p>
    </section>
  );
}

function Connect({ again }: { again: boolean }) {
  return (
    <section aria-labelledby="connect-title" className="space-y-4 card-life">
      <h2 id="connect-title" className="text-lg font-semibold">
        {again ? "Connect your bank again" : "Connect your bank"}
      </h2>
      {lunchflowReady() ? (
        <>
          <p className="text-sm text-body">
            Money reads your accounts through Lunch Flow. It only ever keeps an account&apos;s type and last 4 digits.
            {again && " Your history from before is still here."}
          </p>
          <ConnectBank again={again} />
        </>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-body">
          <li>In Lunch Flow, add a REST API destination, and under Account Access allow only your current account.</li>
          <li>
            In Vercel, add its key as <code className="text-bright">LUNCHFLOW_API_KEY</code> (Production, marked
            sensitive), then redeploy.
          </li>
          <li>Come back here and tap Connect.</li>
        </ol>
      )}
    </section>
  );
}

function Connection({ connected, s }: { connected: boolean; s: MoneyState }) {
  const keySet = moneySyncKey() !== null;
  return (
    <section aria-labelledby="connection-title" className="space-y-3 card-life">
      <h2 id="connection-title" className="font-semibold">
        Bank connection
      </h2>
      {connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3 text-sm">
          <p className="min-w-0">
            <span className="block text-body">Syncs on its own four times a day</span>
            <span className="block text-xs text-muted">
              {s.syncKey
                ? s.syncKey.lastUsedAt
                  ? `On. Last ran ${ago(s.syncKey.lastUsedAt, now())}.`
                  : "On. It runs at the next scheduled time."
                : keySet
                  ? "Off until you tap Register."
                  : "Off. Add CRON_SECRET and MONEY_SYNC_KEY in Vercel (any long random text each), redeploy, then tap Register."}
            </span>
          </p>
          {keySet && (
            <ActionButton
              action={registerSyncKey}
              className="btn-soft px-3 py-1.5 text-xs"
              done="The scheduled sync is on."
            >
              {s.syncKey ? "Register again" : "Register"}
            </ActionButton>
          )}
        </div>
      )}
      <p className="text-sm text-muted">
        Disconnecting stops the syncs and keeps your history. Erasing deletes every account, balance, payment and sync
        from the portal. Delete the key in Lunch Flow too if you no longer want it.
      </p>
      <div className="flex flex-wrap gap-2">
        {connected && (
          <ActionButton
            action={disconnectBank}
            className="btn-soft"
            confirm="Stop reading your bank? Your history stays."
            done="Disconnected."
          >
            Disconnect
          </ActionButton>
        )}
        <ActionButton
          action={forgetBank}
          className="btn bg-coral/10 text-coral ring-1 ring-coral/30 hover:bg-coral/20"
          confirm="Erase all bank data from the portal? This can't be undone."
          done="Bank data erased."
        >
          Erase all bank data
        </ActionButton>
      </div>
    </section>
  );
}
