import Link from "next/link";
import type { BudgetView } from "@/lib/money/budget";
import type { CheckIn } from "@/lib/money/checkin";
import type { Prompt } from "@/lib/money/prompts";
import { pounds } from "@/lib/money/state";
import { ActionButton } from "./life/kit";
import { checkIn, dismissAlert } from "./life/money/actions";

/**
 * The Monday check-in: last week in one line, the category that moved most, and one tap
 * to say what happens to it (checkin.ts). Neutral after an overspend: sand, never coral.
 */
export function MoneyCheckIn({ card }: { card: CheckIn }) {
  return (
    <section
      aria-label="Last week"
      className={`space-y-3 rounded-xl p-3 text-sm ring-1 ${card.over > 0 ? "bg-sand/10 ring-sand/30" : "bg-white/5 ring-white/10"}`}
    >
      <div className="space-y-1">
        <p className={`font-semibold tabular-nums ${card.over > 0 ? "text-sand" : "text-bright"}`}>{card.line}</p>
        {card.moved && <p className="text-body tabular-nums">{card.moved}</p>}
        <p className="text-muted">{card.note}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {card.options.map((o) => (
          <ActionButton
            key={`${o.choice}:${o.goal ?? ""}`}
            action={checkIn.bind(null, o.choice, o.goal ?? null)}
            className="tap btn-soft px-3 py-1.5 text-sm"
            done="Checked in: on to this week."
          >
            {o.label}
          </ActionButton>
        ))}
      </div>
    </section>
  );
}

/** Money speaking up on Today: at most two things that need you, each with where to see it. */
export function MoneyPrompts({ prompts }: { prompts: Prompt[] }) {
  return (
    <section aria-label="Money needs you" className="space-y-2">
      {prompts.map((p) => (
        <div
          key={p.key}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-sm ring-1 ${p.tone === "warn" ? "bg-sand/10 text-sand ring-sand/30" : "bg-white/5 text-body ring-white/10"}`}
        >
          <Link href={p.href} className="min-w-0 flex-1 hover:underline">
            {p.text}
          </Link>
          {p.alertId !== undefined && (
            <ActionButton
              action={dismissAlert.bind(null, p.alertId)}
              className="btn-soft shrink-0 px-3 py-1.5 text-xs"
              done="Dismissed."
              label="Dismiss"
            >
              Dismiss
            </ActionButton>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * Today's one line about money: this week's amount (and how much of it the shops due
 * before Monday still need), and how the weeks to payday look.
 */
export function MoneyLine({ view: v, shop = 0 }: { view: BudgetView; shop?: number }) {
  const left = v.week.left ?? 0;
  const payday = new Date(`${v.payday}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return (
    <Link
      href="/life/money"
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 card transition hover:ring-white/20"
    >
      <span className={`text-lg font-semibold tabular-nums ${left < 0 ? "text-coral" : "text-bright"}`}>
        {left < 0 ? `${pounds(-left)} over this week` : `${pounds(left)} left this week`}
      </span>
      <span className={`text-sm ${v.onTrack === false ? "text-coral" : "text-muted"}`}>
        {v.perWeek !== null && v.perWeek > 0 ? `${pounds(v.perWeek)} a week to payday, ${payday}` : `Payday ${payday}`}
      </span>
      {shop > 0 && left > 0 && (
        <span className="basis-full text-sm text-body tabular-nums">
          {shop >= left
            ? `The shops before Monday need ${pounds(shop)}: more than is left.`
            : `${pounds(shop)} of it for the shops before Monday, ${pounds(left - shop)} for the rest.`}
        </span>
      )}
    </Link>
  );
}
