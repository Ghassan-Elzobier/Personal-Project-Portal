"use client";

import { useState, useTransition } from "react";
import type { Offer } from "@/lib/calendar/free-slot";
import { clock, weekdayIndex } from "@/lib/dates/week";
import { formatHours } from "@/lib/tasks/session-log";
import { ErrorNote } from "@/components/ui";
import { addStudySession, scheduleTask, type ActionResult } from "./actions";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A task an offer can be planned on. "schedule" gives a task in To plan its time;
 * "session" adds one more session on a task already planned (Google Calendar only).
 */
export type PlanTask = { gid: string; title: string; via: "schedule" | "session" };

/** "Tue 18:00, 1 h". */
const label = (o: Offer) => `${WEEKDAY[weekdayIndex(o.date)]} ${clock(o.start)}, ${formatHours(o.duration / 60)} h`;

/**
 * The study line's "still to place" made into times: Find times shows a free time on
 * each of up to three days to come, and Plan puts a block there in one tap. The offers
 * come from the server on every render, so after a save they are worked out afresh.
 */
export function PlaceShort({ offers, tasks }: { offers: Offer[]; tasks: PlanTask[] }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn-ghost min-h-11 px-4 py-1.5" onClick={() => setOpen(true)}>
        Find times
      </button>
    );
  if (offers.length === 0)
    return (
      <p className="rounded-xl bg-white/5 p-3 text-sm text-muted">
        No day left this week has a free hour before 22:00. Use Add below to fit study in by hand.
      </p>
    );
  if (tasks.length === 0)
    return (
      <p className="rounded-xl bg-white/5 p-3 text-sm text-muted">
        Free from {label(offers[0])}, but no open task is left to plan. Add a task in Tasks, or use Add below.
      </p>
    );
  return (
    <ul className="space-y-2" aria-label="Times to place study">
      {offers.map((o) => (
        // Keyed by time and task list, so a pick never outlives the offer or a task that went.
        <OfferRow
          key={`${o.date}-${o.start}-${o.duration}-${tasks.map((t) => t.gid).join()}`}
          offer={o}
          tasks={tasks}
        />
      ))}
    </ul>
  );
}

function OfferRow({ offer, tasks }: { offer: Offer; tasks: PlanTask[] }) {
  // The task due soonest in To plan comes first; the page orders them.
  const [gid, setGid] = useState(tasks[0].gid);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const task = tasks.find((t) => t.gid === gid) ?? tasks[0];
  const plan = () => {
    setError(null);
    startTransition(async () => {
      const input = { gid: task.gid, date: offer.date, start: offer.start, duration: offer.duration };
      const result: ActionResult = await (task.via === "schedule" ? scheduleTask(input) : addStudySession(input));
      if (result.error) setError(result.error);
    });
  };
  return (
    <li className="space-y-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-bright tabular-nums">{label(offer)}</span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Task for {label(offer)}</span>
          <select className="field-input mt-0" value={task.gid} onChange={(e) => setGid(e.target.value)}>
            {tasks.map((t) => (
              <option key={t.gid} value={t.gid}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-primary min-h-11 px-4 py-1.5"
          aria-busy={pending}
          disabled={pending}
          onClick={plan}
          aria-label={`Plan ${label(offer)}`}
        >
          Plan
        </button>
      </div>
      {error && <ErrorNote message={error} />}
    </li>
  );
}
