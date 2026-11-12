"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { shortDate } from "@/lib/dates/week";
import { dayAfterHours, weeksFor } from "@/lib/study/pace";
import { spreadDates } from "@/lib/study/review";
import { loadAllPlans, loadPlan, setPace, setRoadmapPace } from "./actions";

export function LoadPlanButton({ project, label, className = "btn-primary" }: { project: string; label: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending} aria-busy={pending}
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
      disabled={pending} aria-busy={pending}
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

/** Dates all three plans together by hours a week, with an optional change of pace. Press it again after a slow week. */
export function RoadmapPaceForm({ hoursLeft, today, dated, remaining, defaultHours }: { hoursLeft: number; today: string; dated: number; remaining: number; defaultHours: number }) {
  const [hours, setHours] = useState(String(defaultHours));
  const [startOn, setStartOn] = useState(today);
  const [changes, setChanges] = useState(false);
  const [from, setFrom] = useState("");
  const [later, setLater] = useState("18");
  const [pending, start] = useTransition();
  const pace = Number(hours);
  const laterPace = Number(later);
  const usesChange = changes && Boolean(from) && from > (startOn || today) && laterPace > 0;
  const valid = pace > 0 && hoursLeft > 0 && (!changes || usesChange);
  const planned = { hoursPerWeek: pace, until: usesChange ? from : undefined, thenHoursPerWeek: usesChange ? laterPace : undefined };
  const weeks = valid ? weeksFor(startOn || today, hoursLeft, planned) : 0;
  const finish = valid ? dayAfterHours(startOn || today, hoursLeft, planned) : null;
  const field = "min-h-9 rounded-md border border-white/10 bg-white/5 px-2";

  return (
    <form
      className="space-y-2 rounded-xl bg-white/5 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (dated > 0 && !window.confirm(`This replaces the due dates on ${dated} of the ${remaining} units still to do. Continue?`)) return;
        start(async () => {
          const result = await setRoadmapPace(pace, startOn, usesChange ? { from, hoursPerWeek: laterPace } : undefined);
          toast(result.error ?? `Dates set for ${result.count} units.`, result.error ? { tone: "error" } : {});
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="roadmap-hours" className="text-neutral-300">Study</label>
        <input id="roadmap-hours" type="number" min={1} max={100} value={hours} onChange={(e) => setHours(e.target.value)} className={`${field} w-16`} />
        <span className="text-neutral-300">hours a week, from</span>
        <label htmlFor="roadmap-start" className="sr-only">Start date</label>
        <input id="roadmap-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className={field} />
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-neutral-300">
          <input type="checkbox" checked={changes} onChange={(e) => setChanges(e.target.checked)} />
          My hours change later
        </label>
      </div>
      {changes && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="roadmap-from" className="text-neutral-300">From</label>
          <input id="roadmap-from" type="date" min={startOn || today} value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          <label htmlFor="roadmap-later" className="text-neutral-300">study</label>
          <input id="roadmap-later" type="number" min={1} max={100} value={later} onChange={(e) => setLater(e.target.value)} className={`${field} w-16`} />
          <span className="text-neutral-300">hours a week</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button disabled={pending || !valid} aria-busy={pending} className="btn-ghost px-4 py-1.5">Set dates across all three</button>
        {finish && <span className="text-neutral-300">About {weeks} weeks, to around {shortDate(finish)}.</span>}
      </div>
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
      <button disabled={pending || !finish} aria-busy={pending} className="btn-ghost px-4 py-1.5">Set dates</button>
      {finish && <span className="text-neutral-300">Finishes around {shortDate(finish)}.</span>}
    </form>
  );
}
