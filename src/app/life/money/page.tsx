import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { now } from "@/lib/dates/clock";
import { loadMoney } from "@/lib/money/load";
import { lunchflowReady } from "@/lib/money/lunchflow";
import { ago, feedNote, pounds, type MoneyState } from "@/lib/money/state";
import { ErrorNote } from "@/components/ui";
import { ActionButton } from "../kit";
import { LifeHeader } from "../parts";
import { disconnectBank, forgetBank, refreshBank } from "./actions";
import { ConnectBank } from "./connect";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

const INTRO = "Your bank balance, read from Lunch Flow and kept fresh through the day.";

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
      {s.connection && <Connection connected={connected} />}
    </div>
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

function Connection({ connected }: { connected: boolean }) {
  return (
    <section aria-labelledby="connection-title" className="space-y-3 card-life">
      <h2 id="connection-title" className="font-semibold">
        Bank connection
      </h2>
      <p className="text-sm text-muted">
        Disconnecting stops the syncs and keeps your history. Erasing deletes every account, balance and sync from the
        portal. Delete the key in Lunch Flow too if you no longer want it.
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
