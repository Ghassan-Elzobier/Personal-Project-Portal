import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { moneySyncKey, timeZone } from "@/lib/config/env";
import { now } from "@/lib/dates/clock";
import { dateIn } from "@/lib/dates/week";
import { loadMoney } from "@/lib/money/load";
import { lunchflowReady } from "@/lib/money/lunchflow";
import { ago, byDay, feedNote, pounds, txnName, type MoneyState, type Txn } from "@/lib/money/state";
import { Empty, ErrorNote } from "@/components/ui";
import { ActionButton } from "../kit";
import { LifeHeader } from "../parts";
import { disconnectBank, forgetBank, refreshBank, registerSyncKey } from "./actions";
import { ConnectBank } from "./connect";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

const INTRO = "Your bank balance and payments, read from Lunch Flow and kept fresh through the day.";

const METHOD: Record<string, string> = {
  card: "Card",
  "direct-debit": "Direct Debit",
  "standing-order": "Standing order",
  transfer: "Transfer",
  cash: "Cash",
};

function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  if (Math.round((t.getTime() - d.getTime()) / 86_400_000) === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

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
      {connected ? <Balances s={s} /> : <Connect again={s.connection?.status === "off"} />}
      {s.accounts.length > 0 && <Payments txns={loaded.txns} />}
      {s.connection && <Connection connected={connected} s={s} />}
    </div>
  );
}

function Payments({ txns }: { txns: Txn[] }) {
  const today = dateIn(now(), timeZone());
  const days = byDay(txns);
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
      {days.length === 0 ? (
        <Empty>No payments yet. They come in with the next sync, or from a statement.</Empty>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <div key={d.day ?? "pending"} className="space-y-1">
              <p className="flex justify-between gap-3 eyebrow">
                <span>{d.day ? dayName(d.day, today) : "Pending"}</span>
                {d.out > 0 && <span className="tabular-nums">{pounds(-d.out)}</span>}
              </p>
              <ul className="divide-y divide-white/5 rounded-xl bg-white/5">
                {d.txns.map((t) => (
                  <li key={t.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{txnName(t)}</span>
                      <span className="block truncate text-xs text-muted">
                        {[
                          t.status === "pending" ? "Pending" : METHOD[t.method],
                          t.source === "statement" ? "From a statement" : null,
                          t.note,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className={`shrink-0 text-sm tabular-nums ${t.pence > 0 ? "text-mint" : "text-bright"}`}>
                      {t.pence > 0 ? `+${pounds(t.pence)}` : pounds(t.pence)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-faint">The last 60 days.</p>
        </div>
      )}
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
