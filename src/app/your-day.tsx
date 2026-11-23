"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "@/components/toaster";
import { clock } from "@/lib/dates/week";
import type { Day, DayItem } from "@/lib/portal/day";
import { cookPlanned, logMeal, uncook } from "./life/actions";
import { toastCooked } from "./life/kit";
import { withNextWeek } from "@/lib/life/cooked";
import { moveBlock } from "./schedule/actions";

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
        const slot = i.slot;
        const r = await logMeal(date, slot, next ? "eaten" : null);
        if (r.error !== undefined) return void toast(r.error, { tone: "error" });
        // A meal from a cook that wasn't logged logs the cook too; Undo takes both back.
        toastCooked(
          r.cooked,
          () =>
            start(async () => {
              await logMeal(date, slot, null);
              for (const c of r.cooked ?? []) {
                const back = await uncook(c.batch);
                if (back.error) return void toast(back.error, { tone: "error" });
              }
            }),
          r,
        );
      } else if (i.kind === "cook" && i.cookIds && day.planStart) {
        let planningNext = false;
        for (const id of i.cookIds) {
          const r = await cookPlanned(day.planStart, id);
          if (r.error !== undefined) return void toast(r.error, { tone: "error" });
          planningNext ||= r.planningNext;
        }
        toast(withNextWeek("In the fridge. The Kitchen says what to freeze.", { planningNext }));
      }
    });
  // A missed study block goes to the free time it was offered. The page comes back with it
  // there; Undo puts it where it was.
  const [moving, startMove] = useTransition();
  const move = (i: DayItem) =>
    startMove(async () => {
      const to = i.move;
      if (!to) return;
      const there = { source: to.source, id: to.id, duration: to.duration };
      const r = await moveBlock({ ...there, date: to.date, start: to.start });
      if (r.error) return void toast(r.error, { tone: "error" });
      toast(`Moved to ${to.date === date ? "" : "tomorrow, "}${clock(to.start)}.`, {
        action: {
          label: "Undo",
          onClick: () =>
            startMove(async () => {
              // Back on its own day: today's, or the earlier day a carried block was on.
              const back = await moveBlock({ ...there, date: i.date ?? date, start: i.start });
              if (back.error) toast(back.error, { tone: "error" });
            }),
        },
      });
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
            const next = i.key === day.nextKey && !done[i.key];
            return (
              <Row
                key={i.key}
                item={i}
                isDone={done[i.key]}
                next={next}
                past={!next && i.start >= 0 && Math.max(i.end, i.start + 1) <= now}
                moving={moving}
                onMove={() => move(i)}
                onTick={() => tick(i)}
              />
            );
          })}
        </ol>
      )}
      {day.carried.length > 0 && (
        // Study missed on an earlier day this week and still owed: a new time today, in one tap.
        <section aria-labelledby="carried-title" className="space-y-1 border-t border-white/5 pt-3">
          <h3 id="carried-title" className="px-2 text-xs font-semibold text-muted">
            Missed earlier this week
          </h3>
          <ul className="space-y-1">
            {day.carried.map((i) => (
              <Row
                key={i.key}
                item={i}
                isDone={i.done}
                next={false}
                past
                day={i.date ? weekday(i.date) : undefined}
                moving={moving}
                onMove={() => move(i)}
                onTick={() => {}}
              />
            ))}
          </ul>
          {day.carriedMore > 0 && (
            <Link href="/schedule" className="block px-2 text-xs text-muted underline underline-offset-2">
              {day.carriedMore} more on the Schedule
            </Link>
          )}
        </section>
      )}
    </section>
  );
}

const weekday = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** One item of the day: its time (or its day, carried from earlier), what it is, and its one tap. */
function Row({
  item: i,
  isDone,
  next,
  past,
  day,
  moving,
  onMove,
  onTick,
}: {
  item: DayItem;
  isDone: boolean;
  next: boolean;
  past: boolean;
  /** Shown in place of the time, for a block from an earlier day. */
  day?: string;
  moving: boolean;
  onMove: () => void;
  onTick: () => void;
}) {
  const tappable = (i.kind === "meal" && i.slot) || (i.kind === "cook" && i.cookIds?.length && !isDone);
  const body = (
    <>
      <span
        className={`block truncate text-sm font-medium ${isDone ? "text-faint line-through" : i.skipped ? "text-faint" : ""}`}
      >
        {i.title}
      </span>
      {i.detail && <span className="block truncate text-xs text-muted">{i.detail}</span>}
      {i.note && <span className={`block truncate text-xs ${i.clash ? "text-coral" : "text-faint"}`}>{i.note}</span>}
    </>
  );
  return (
    <li
      className={`flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 ${next ? "bg-lavender/10 ring-1 ring-lavender/40" : ""}`}
    >
      <span className={`w-11 shrink-0 text-xs tabular-nums ${past ? "text-faint" : "text-body"}`}>
        {day ?? (i.start >= 0 ? clock(i.start) : "")}
      </span>
      <span
        className={`size-2 shrink-0 rounded-full ${DOT[i.kind]} ${isDone || i.skipped ? "opacity-30" : ""}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {i.external ? (
          <a href={i.href} target="_blank" rel="noreferrer" className="block min-w-0">
            {body}
          </a>
        ) : (
          <Link href={i.href} className="block min-w-0">
            {body}
          </Link>
        )}
        {i.missed && (
          // On its own line under the name, so the offer never squeezes the name out on a phone.
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-sand">Missed</span>
            {i.move && (
              <button
                type="button"
                onClick={onMove}
                disabled={moving}
                aria-busy={moving}
                className="cursor-pointer rounded-full bg-sand/15 px-3 py-1.5 font-semibold text-sand ring-1 ring-sand/30 disabled:opacity-60"
              >
                {i.move.label}
              </button>
            )}
            {i.taskGid && (
              <Link href={`/log?task=${i.taskGid}`} className="text-muted underline underline-offset-2">
                Log it if you did study
              </Link>
            )}
          </p>
        )}
      </div>
      <Action item={i} isDone={isDone} next={next} past={past} tappable={Boolean(tappable)} onTick={onTick} />
    </li>
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
  // A missed study block has its own line under its name: the move it is offered, and Log.
  if (i.missed) return null;
  if (i.kind === "gym") return pill("/life/gym", "Start");
  if (i.kind === "weigh") return pill("/life/body", "Log");
  // A fresh week's shop, not the untimed "plan the week" nudge.
  if (i.kind === "shop" && i.start >= 0) return pill(i.href, "See list");
  // Study: log it once it has started.
  if (i.kind === "study" && i.taskGid && (next || past)) return pill(`/log?task=${i.taskGid}`, "Log");
  return null;
}
