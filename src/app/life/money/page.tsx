import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { moneySyncKey, timeZone } from "@/lib/config/env";
import { now } from "@/lib/dates/clock";
import { dateIn } from "@/lib/dates/week";
import { loadMoney } from "@/lib/money/load";
import { lunchflowReady } from "@/lib/money/lunchflow";
import { ago, feedNote, monthView, pounds, type MoneyState, type Txn } from "@/lib/money/state";
import { Empty, ErrorNote } from "@/components/ui";
import { ActionButton } from "../kit";
import { LifeHeader } from "../parts";
import { disconnectBank, dismissAlert, forgetBank, refreshBank, registerSyncKey, setClaudeAccess } from "./actions";
import { ConnectBank } from "./connect";
import { PaymentList } from "./payments";

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
  const [, loaded] = await Promise.all([requireOwner(), loadMoney()]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Money">{INTRO}</LifeHeader>
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const note = feedNote(s);
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
      {connected ? <Balances s={s} /> : <Connect again={s.connection?.status === "off"} />}
      {s.accounts.length > 0 && <ThisMonth s={s} />}
      {s.accounts.length > 0 && <Payments s={s} txns={loaded.txns} />}
      {s.connection && <Claude s={s} />}
      {s.connection && <Connection connected={connected} s={s} />}
    </div>
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
          <p className="min-w-0">
            {a.payment
              ? `${a.payment.name}: ${pounds(a.payment.pence)} on ${new Date(`${a.payment.madeOn}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}. A merchant you're watching.`
              : "Something in Money needs a look."}
          </p>
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
              {c.share !== null && (
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                  <div
                    className={`h-full rounded-full ${c.over ? "bg-coral" : "bg-mint"}`}
                    style={{ width: `${Math.round(c.share * 100)}%` }}
                  />
                </div>
              )}
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
