import Link from "next/link";
import type { BudgetView } from "@/lib/money/budget";
import type { Prompt } from "@/lib/money/prompts";
import { pounds } from "@/lib/money/state";
import { ActionButton } from "./life/kit";
import { dismissAlert } from "./life/money/actions";

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
 * Today's one line about money: this week's amount (and how much of it the meal plan's
 * shop still needs), and how the weeks to payday look.
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
            ? `The meal plan's shop still needs ${pounds(shop)}: more than is left.`
            : `${pounds(shop)} of it for the meal plan's shop, ${pounds(left - shop)} for the rest.`}
        </span>
      )}
    </Link>
  );
}
