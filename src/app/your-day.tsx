"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "@/components/toaster";
import { cookPlanned, logMeal } from "./life/actions";

export type DayItem = {
  key: string;
  time: string;
  minutes: number;
  kind: "weigh" | "meal" | "gym" | "cook" | "defrost" | "freeze" | "shop";
  title: string;
  detail: string;
  done: boolean;
  skipped: boolean;
  href: string;
  slot?: "breakfast" | "lunch" | "shake" | "dinner";
  cookId?: string;
  kcal?: number;
};

const DOT: Record<DayItem["kind"], string> = {
  weigh: "bg-lavender",
  meal: "bg-sand",
  gym: "bg-mint",
  cook: "bg-orange",
  defrost: "bg-sky-400",
  freeze: "bg-sky-400",
  shop: "bg-aqua",
};

/** Today's routine in order, each with its one tap. The next thing to do stands out. */
export function YourDay({ date, items, nextKey, planStart, summary }: { date: string; items: DayItem[]; nextKey: string | null; planStart: string | null; summary: string | null }) {
  const [, start] = useTransition();
  const [done, setDone] = useOptimistic(
    Object.fromEntries(items.map((i) => [i.key, i.done])) as Record<string, boolean>,
    (cur, change: { key: string; done: boolean }) => ({ ...cur, [change.key]: change.done }),
  );
  const tick = (i: DayItem) =>
    start(async () => {
      const next = !done[i.key];
      setDone({ key: i.key, done: next });
      const r = i.kind === "meal" && i.slot ? await logMeal(date, i.slot, next ? "eaten" : null) : i.kind === "cook" && i.cookId && planStart ? await cookPlanned(planStart, i.cookId) : { error: undefined };
      if (r.error) toast(r.error, { tone: "error" });
    });
  return (
    <section aria-labelledby="day-title" className="card-life space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="day-title" className="text-lg font-semibold">
          Your day
        </h2>
        {summary && <span className="text-xs text-neutral-400 tabular-nums">{summary}</span>}
      </div>
      <ol className="relative space-y-1">
        {items.map((i) => {
          const isDone = done[i.key];
          const next = i.key === nextKey && !isDone;
          const tappable = (i.kind === "meal" && i.slot) || (i.kind === "cook" && !isDone);
          return (
            <li key={i.key} className={`flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 ${next ? "bg-mint/10 ring-1 ring-mint/30" : ""}`}>
              <span className="w-11 shrink-0 text-xs text-neutral-400 tabular-nums">{i.time}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[i.kind]} ${isDone || i.skipped ? "opacity-30" : ""}`} aria-hidden />
              <Link href={i.href} className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-medium ${isDone ? "text-neutral-500 line-through" : i.skipped ? "text-neutral-500" : ""}`}>{i.title}</span>
                <span className="block truncate text-xs text-neutral-400">{i.detail}</span>
              </Link>
              {tappable ? (
                <button
                  type="button"
                  onClick={() => tick(i)}
                  aria-pressed={isDone}
                  aria-label={isDone ? `Undo ${i.title}` : `Done: ${i.title}`}
                  className={`tap h-10 w-10 shrink-0 rounded-full ring-1 ${isDone ? "bg-mint text-primary ring-mint" : next ? "text-mint ring-mint/60" : "text-neutral-500 ring-white/15 hover:text-mint"}`}
                >
                  ✓
                </button>
              ) : i.kind === "gym" && !isDone ? (
                <Link href="/life/gym" className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${next ? "bg-mint text-primary" : "bg-white/5 text-mint"}`}>
                  Start
                </Link>
              ) : i.kind === "weigh" && !isDone ? (
                <Link href="/life/body" className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${next ? "bg-mint text-primary" : "bg-white/5 text-mint"}`}>
                  Log
                </Link>
              ) : isDone ? (
                <span className="w-10 shrink-0 text-center text-mint" aria-label="Done">
                  ✓
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
