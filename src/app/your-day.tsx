"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "@/components/toaster";
import { clock } from "@/lib/dates/week";
import type { Day, DayItem } from "@/lib/portal/day";
import { cookPlanned, logMeal } from "./life/actions";

const DOT: Record<DayItem["kind"], string> = {
  weigh: "bg-lavender",
  meal: "bg-sand",
  gym: "bg-mint",
  cook: "bg-orange",
  defrost: "bg-sky-400",
  freeze: "bg-sky-400",
  shop: "bg-aqua",
  study: "bg-gradient-to-b from-royal to-lavender",
  event: "bg-neutral-400",
  life: "bg-mint",
};

/**
 * Today, the way the Schedule has it: study, events, meals, cooking and the gym in
 * time order, each with its one tap. What comes next stands out.
 */
export function YourDay({ date, day, now, error }: { date: string; day: Day; now: number; error?: string }) {
  const [, start] = useTransition();
  const [done, setDone] = useOptimistic(
    Object.fromEntries(day.items.map((i) => [i.key, i.done])) as Record<string, boolean>,
    (cur, change: { key: string; done: boolean }) => ({ ...cur, [change.key]: change.done }),
  );
  const tick = (i: DayItem) =>
    start(async () => {
      const next = !done[i.key];
      setDone({ key: i.key, done: next });
      if (i.kind === "meal" && i.slot) {
        const r = await logMeal(date, i.slot, next ? "eaten" : null);
        if (r.error) toast(r.error, { tone: "error" });
      } else if (i.kind === "cook" && i.cookIds && day.planStart) {
        for (const id of i.cookIds) {
          const r = await cookPlanned(day.planStart, id);
          if (r.error) return void toast(r.error, { tone: "error" });
        }
        toast("In the fridge. The Kitchen says what to freeze.");
      }
    });

  return (
    <section aria-labelledby="day-title" className="space-y-3 card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="day-title" className="text-lg font-semibold">
          Your day
        </h2>
        <Link href="/schedule" className="text-sm text-muted hover:text-white">
          Open schedule
        </Link>
        {day.summary && <p className="w-full text-xs text-muted tabular-nums">{day.summary}</p>}
      </div>
      {error && <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
      {day.items.length === 0 ? (
        <p className="rounded-xl bg-white/5 p-4 text-sm text-muted">
          Nothing planned today. Drag a task onto a time on the Schedule.
        </p>
      ) : (
        <ol className="space-y-1">
          {day.items.map((i) => {
            const isDone = done[i.key];
            const next = i.key === day.nextKey && !isDone;
            const past = !next && i.start >= 0 && Math.max(i.end, i.start + 1) <= now;
            const tappable = (i.kind === "meal" && i.slot) || (i.kind === "cook" && i.cookIds?.length && !isDone);
            const body = (
              <>
                <span
                  className={`block truncate text-sm font-medium ${isDone ? "text-faint line-through" : i.skipped ? "text-faint" : ""}`}
                >
                  {i.title}
                </span>
                {i.detail && <span className="block truncate text-xs text-muted">{i.detail}</span>}
                {i.note && (
                  <span className={`block truncate text-xs ${i.clash ? "text-coral" : "text-faint"}`}>{i.note}</span>
                )}
              </>
            );
            return (
              <li
                key={i.key}
                className={`flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 ${next ? "bg-lavender/10 ring-1 ring-lavender/40" : ""}`}
              >
                <span className={`w-11 shrink-0 text-xs tabular-nums ${past ? "text-faint" : "text-body"}`}>
                  {i.start >= 0 ? clock(i.start) : ""}
                </span>
                <span
                  className={`size-2 shrink-0 rounded-full ${DOT[i.kind]} ${isDone || i.skipped ? "opacity-30" : ""}`}
                  aria-hidden
                />
                {i.external ? (
                  <a href={i.href} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                    {body}
                  </a>
                ) : (
                  <Link href={i.href} className="min-w-0 flex-1">
                    {body}
                  </Link>
                )}
                <Action
                  item={i}
                  isDone={isDone}
                  next={next}
                  past={past}
                  tappable={Boolean(tappable)}
                  onTick={() => tick(i)}
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Action({
  item: i,
  isDone,
  next,
  past,
  tappable,
  onTick,
}: {
  item: DayItem;
  isDone: boolean;
  next: boolean;
  past: boolean;
  tappable: boolean;
  onTick: () => void;
}) {
  const pill = (href: string, label: string) => (
    <Link
      href={href}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${next ? "bg-lavender text-white" : "bg-white/5 text-bright"}`}
    >
      {label}
    </Link>
  );
  if (tappable) {
    return (
      <button
        type="button"
        onClick={onTick}
        aria-pressed={isDone}
        aria-label={isDone ? `Undo ${i.title}` : `Done: ${i.title}`}
        className={`tap size-10 shrink-0 rounded-full ring-1 ${isDone ? "bg-mint text-primary ring-mint" : next ? "text-mint ring-mint/60" : "text-faint ring-white/15 hover:text-mint"}`}
      >
        ✓
      </button>
    );
  }
  if (isDone) {
    return (
      <span className="w-10 shrink-0 text-center text-mint" aria-label="Done">
        ✓
      </span>
    );
  }
  if (i.kind === "gym") return pill("/life/gym", "Start");
  if (i.kind === "weigh") return pill("/life/body", "Log");
  // Study: log it once it has started.
  if (i.kind === "study" && i.taskGid && (next || past)) return pill(`/log?task=${i.taskGid}`, "Log");
  return null;
}
