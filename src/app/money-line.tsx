import Link from "next/link";
import type { BudgetView } from "@/lib/money/budget";
import { pounds } from "@/lib/money/state";

/** Today's one line about money: this week's amount, and how the weeks to payday look. */
export function MoneyLine({ view: v }: { view: BudgetView }) {
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
    </Link>
  );
}
