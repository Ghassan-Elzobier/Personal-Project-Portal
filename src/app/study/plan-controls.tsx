"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { addDays, shortDate } from "@/lib/dates/week";
import { spreadDates } from "@/lib/study/review";
import { loadAllPlans, loadPlan, setPace, setRoadmapPace } from "./actions";

export function LoadPlanButton({ project, label, className = "btn-primary" }: { project: string; label: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className={className}
      onClick={() =>
        start(async () => {
          const result = await loadPlan(project);
          toast(result.error ?? `Added ${result.added} ${result.added === 1 ? "task" : "tasks"}.`, result.error ? { tone: "error" } : {});
        })
      }
    >
      {pending ? "Loading…" : label}
    </button>
  );
}

export function LoadAllButton({ label, className = "btn-primary" }: { label: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className={className}
      onClick={() =>
        start(async () => {
          const result = await loadAllPlans();
          toast(result.error ?? `Added ${result.added} ${result.added === 1 ? "task" : "tasks"}.`, result.error ? { tone: "error" } : {});
        })
      }
    >
      {pending ? "Loading…" : label}
    </button>
  );
}

/** Dates all three plans together by hours a week. Press it again after a slow week. */
export function RoadmapPaceForm({ hoursLeft, today, dated, remaining, defaultHours }: { hoursLeft: number; today: string; dated: number; remaining: number; defaultHours: number }) {
  const [hours, setHours] = useState(String(defaultHours));
  const [startOn, setStartOn] = useState(today);
  const [pending, start] = useTransition();
  const pace = Number(hours);
  const valid = pace > 0 && hoursLeft > 0;
  const weeks = valid ? Math.ceil(hoursLeft / pace) : 0;
  const finish = valid ? addDays(startOn || today, Math.max(Math.ceil((hoursLeft * 7) / pace) - 1, 0)) : null;

  return (
    <form
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white/5 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (dated > 0 && !window.confirm(`This replaces the due dates on ${dated} of the ${remaining} units still to do. Continue?`)) return;
        start(async () => {
          const result = await setRoadmapPace(pace, startOn);
          toast(result.error ?? `Dates set for ${result.count} units.`, result.error ? { tone: "error" } : {});
        });
      }}
    >
      <label htmlFor="roadmap-hours" className="text-neutral-300">Study</label>
      <input id="roadmap-hours" type="number" min={1} max={100} value={hours} onChange={(e) => setHours(e.target.value)} className="min-h-9 w-16 rounded-md border border-white/10 bg-white/5 px-2" />
      <span className="text-neutral-300">hours a week, from</span>
      <label htmlFor="roadmap-start" className="sr-only">Start date</label>
      <input id="roadmap-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className="min-h-9 rounded-md border border-white/10 bg-white/5 px-2" />
      <button disabled={pending || !valid} className="btn-ghost px-4 py-1.5">Set dates across all three</button>
      {finish && <span className="text-neutral-300">About {weeks} weeks, to around {shortDate(finish)}.</span>}
    </form>
  );
}

/** Spreads what is left from a start day, and can be pressed again after a slow week. */
export function PaceForm({ project, remaining, label, defaultPerWeek, today, dated }: { project: string; remaining: number; label: string; defaultPerWeek: number; today: string; dated: number }) {
  const [perWeek, setPerWeek] = useState(String(defaultPerWeek));
  const [startOn, setStartOn] = useState(today);
  const [pending, start] = useTransition();
  const pace = Number(perWeek);
  const finish = pace > 0 && remaining > 0 ? spreadDates(Array.from({ length: remaining }), startOn || today, pace).at(-1)?.dueOn : null;
  if (remaining === 0) return null;

  return (
    <form
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white/5 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (dated > 0 && !window.confirm(`This replaces the due dates on ${label} that have one. Continue?`)) return;
        start(async () => {
          const result = await setPace(project, pace, startOn);
          toast(result.error ?? `Dates set for ${result.count} ${label}.`, result.error ? { tone: "error" } : {});
        });
      }}
    >
      <label htmlFor="pace" className="text-neutral-300">Pace</label>
      <input id="pace" type="number" min={1} max={50} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} className="min-h-9 w-16 rounded-md border border-white/10 bg-white/5 px-2" />
      <span className="text-neutral-300">{label} a week, from</span>
      <label htmlFor="pace-start" className="sr-only">Start date</label>
      <input id="pace-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className="min-h-9 rounded-md border border-white/10 bg-white/5 px-2" />
      <button disabled={pending || !finish} className="btn-ghost px-4 py-1.5">Set dates</button>
      {finish && <span className="text-neutral-300">Finishes around {shortDate(finish)}.</span>}
    </form>
  );
}
