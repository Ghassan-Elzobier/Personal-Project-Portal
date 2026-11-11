"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "@/components/toaster";
import { nextExerciseStatus, tallyExercises, type ExerciseStatus } from "@/lib/study/review";
import { addReview, addSubtask, removeReview, removeSubtask, setExercise, setExerciseCount, setSubtask, type ActionResult } from "./actions";

export type PanelData = {
  taskGid: string;
  /** Which kind of plan this came from, if any. Exercises only suit a book. */
  mode: "book" | "lab" | null;
  completed: boolean;
  exerciseCount: number | null;
  exercises: Record<number, ExerciseStatus>;
  steps: { gid: string; name: string; done: boolean }[];
  reviews: { gid: string; prompt: string; dueOn: string | null }[];
  links: { label: string; href: string }[];
  /** The page in a book kept as a local file, which cannot be linked to. */
  pdfPage: number | null;
  needs: { short: string; href: string; done: boolean }[];
  feeds: { short: string; href: string; done: boolean }[];
  connections: { short: string; href: string; done: boolean; why: string }[];
  /** The skills this unit teaches, and how many open roles ask for each. */
  market?: { name: string; must: number; soft: number }[];
};

function useRun() {
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ActionResult>, then?: () => void) =>
    start(async () => {
      const result = await action();
      if (result.error) toast(result.error, { tone: "error" });
      else then?.();
    });
  return { pending, run };
}

/** The study side of a task: where to read, its steps, exercises and reviews. */
export function StudyPanel({ data }: { data: PanelData }) {
  return (
    <div className="space-y-5 border-b border-white/10 pb-5">
      {(data.links.length > 0 || data.pdfPage !== null || data.needs.length > 0 || data.feeds.length > 0) && <References data={data} />}
      {data.connections.length > 0 && <Connections items={data.connections} />}
      {data.market && data.market.length > 0 && <JobMarket items={data.market} />}
      <Steps taskGid={data.taskGid} steps={data.steps} />
      {(data.mode === "book" || data.exerciseCount !== null) && <Exercises data={data} />}
      {(data.mode === "book" || data.reviews.length > 0) && <Reviews data={data} />}
    </div>
  );
}

function JobMarket({ items }: { items: NonNullable<PanelData["market"]> }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">In the job market</h3>
      <ul className="space-y-1 text-sm text-neutral-300">
        {items.map((item) => (
          <li key={item.name}>
            {item.name}: required by {item.must}, wanted by {item.soft} of the roles you are tracking
          </li>
        ))}
      </ul>
      <Link href="/jobs?view=skills" className="text-sm text-aqua underline-offset-4 hover:underline">See skills against the market</Link>
    </div>
  );
}

function Connections({ items }: { items: PanelData["connections"] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">How this connects</h3>
      <ul className="space-y-2 text-sm text-neutral-300">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} scroll={false} className="text-aqua underline-offset-4 hover:underline">
              {item.short}
              {item.done ? " ✓" : ""}
            </Link>
            {": "}
            {item.why}
          </li>
        ))}
      </ul>
    </div>
  );
}

function References({ data }: { data: PanelData }) {
  const unfinished = data.needs.filter((n) => !n.done);
  return (
    <div className="space-y-2 text-sm">
      {data.links.length > 0 && (
        <p className="flex flex-wrap gap-2">
          {data.links.map((l) =>
            // The portal's own pages open here; the PDF and other sites open beside it.
            l.href.startsWith("/") && !l.href.startsWith("/library/pdf") ? (
              <Link key={l.href} href={l.href} className="btn-ghost px-3 py-1 text-xs">
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1 text-xs">
                {l.label}
              </a>
            ),
          )}
        </p>
      )}
      {data.needs.length > 0 && (
        <p className="text-neutral-300">
          <span className={unfinished.length ? "text-sand" : "text-neutral-400"}>{unfinished.length ? "Do these first: " : "Builds on: "}</span>
          <RefLinks items={unfinished.length ? unfinished : data.needs} />
        </p>
      )}
      {data.feeds.length > 0 && (
        <p className="text-neutral-300">
          <span className="text-neutral-400">Feeds into: </span>
          <RefLinks items={data.feeds} />
        </p>
      )}
    </div>
  );
}

function RefLinks({ items }: { items: PanelData["needs"] }) {
  return (
    <>
      {items.map((item, i) => (
        <span key={item.href}>
          {i > 0 && ", "}
          <Link href={item.href} scroll={false} className="underline-offset-4 hover:underline">
            {item.short}
            {item.done ? " ✓" : ""}
          </Link>
        </span>
      ))}
    </>
  );
}

function Steps({ taskGid, steps }: { taskGid: string; steps: PanelData["steps"] }) {
  const { pending, run } = useRun();
  const [shown, toggle] = useOptimistic(steps, (list, change: { gid: string; done: boolean }) =>
    list.map((s) => (s.gid === change.gid ? { ...s, done: change.done } : s)),
  );
  const [name, setName] = useState("");
  const done = shown.filter((s) => s.done).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => addSubtask(taskGid, name), () => setName(""));
  };
  return (
    <section aria-label="Steps">
      <h3 className="font-semibold">
        Steps {shown.length > 0 && <span className="text-sm font-normal text-neutral-400 tabular-nums">{done} of {shown.length}</span>}
      </h3>
      <ul className="mt-2 space-y-1">
        {shown.map((s) => (
          <li key={s.gid} className="group flex items-start gap-3">
            <label className="flex min-h-8 flex-1 cursor-pointer items-start gap-3 py-1 text-sm">
              <input
                type="checkbox"
                checked={s.done}
                disabled={pending}
                onChange={(e) => {
                  const next = e.target.checked;
                  run(() => {
                    toggle({ gid: s.gid, done: next });
                    return setSubtask(s.gid, next);
                  });
                }}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-mint"
              />
              <span className={s.done ? "text-neutral-400 line-through" : ""}>{s.name}</span>
            </label>
            <button
              onClick={() => run(() => removeSubtask(s.gid))}
              aria-label={`Delete step: ${s.name}`}
              className="cursor-pointer px-1 text-xs text-neutral-400 hover:text-white md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-1 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a step"
          aria-label="New step"
          maxLength={300}
          className="min-h-9 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm placeholder-neutral-400 hover:border-white/10 focus:border-white/20"
        />
        {name.trim() && <button disabled={pending} className="btn-ghost px-3 py-1 text-xs">Add</button>}
      </form>
    </section>
  );
}

const STATUS_STYLE: Record<ExerciseStatus, { mark: string; label: string; className: string }> = {
  solved: { mark: "✓", label: "solved on your own", className: "bg-mint/20 text-mint ring-mint/50" },
  hint: { mark: "?", label: "needed a hint", className: "bg-sand/20 text-sand ring-sand/50" },
  stuck: { mark: "!", label: "stuck", className: "bg-coral/20 text-coral ring-coral/50" },
  skip: { mark: "–", label: "skipped", className: "bg-transparent text-neutral-400 ring-white/10" },
};

function Exercises({ data }: { data: PanelData }) {
  const [statuses, setStatuses] = useState(data.exercises);
  const [count, setCount] = useState("");
  const { pending, run } = useRun();
  const timers = useRef(new Map<number, { timer: number; save: () => void }>());

  // Each tap moves to the next state. Saving waits for a pause, so tapping past
  // "stuck" on the way to "skip" does not schedule a review by accident.
  const tap = (n: number) => {
    const next = nextExerciseStatus(statuses[n] ?? null);
    setStatuses((current) => {
      const updated = { ...current };
      if (next) updated[n] = next;
      else delete updated[n];
      return updated;
    });
    const pendingSave = timers.current.get(n);
    if (pendingSave) window.clearTimeout(pendingSave.timer);
    const save = () => {
      timers.current.delete(n);
      void setExercise(data.taskGid, n, next).then((result) => {
        if (result.error) toast(result.error, { tone: "error" });
      });
    };
    timers.current.set(n, { timer: window.setTimeout(save, 500), save });
  };

  // Closing the panel straight after a tap still saves it.
  useEffect(() => {
    const pendingSaves = timers.current;
    return () => {
      for (const { timer, save } of pendingSaves.values()) {
        window.clearTimeout(timer);
        save();
      }
    };
  }, []);

  if (data.exerciseCount === null) {
    return (
      <section aria-label="Exercises">
        <h3 className="font-semibold">Exercises</h3>
        <form
          className="mt-2 flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setExerciseCount(data.taskGid, Number(count)));
          }}
        >
          <label htmlFor="exercise-count" className="text-neutral-300">How many in this chapter?</label>
          <input id="exercise-count" type="number" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} className="min-h-9 w-20 rounded-md border border-white/10 bg-white/5 px-2" />
          <button disabled={pending || !count} className="btn-ghost px-3 py-1 text-xs">Track them</button>
        </form>
      </section>
    );
  }

  const tally = tallyExercises(Object.values(statuses));
  return (
    <section aria-label="Exercises">
      <h3 className="font-semibold">
        Exercises <span className="text-sm font-normal text-neutral-400 tabular-nums">{tally.solved} of {data.exerciseCount} solved</span>
      </h3>
      <p className="mt-1 text-xs text-neutral-400">
        Tap to change: ✓ solved, ? needed a hint, ! stuck, – skipped. Hints and stuck ones come back to redo.
      </p>
      <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
        {Array.from({ length: data.exerciseCount }, (_, i) => i + 1).map((n) => {
          const status = statuses[n];
          const style = status ? STATUS_STYLE[status] : null;
          return (
            <li key={n}>
              <button
                type="button"
                onClick={() => tap(n)}
                aria-label={`Exercise ${n}: ${style?.label ?? "not tried"}`}
                className={`flex h-10 w-full cursor-pointer items-center justify-center gap-0.5 rounded-lg text-sm tabular-nums ring-1 transition hover:ring-white/40 ${style?.className ?? "bg-white/5 text-neutral-200 ring-white/10"}`}
              >
                {n}
                {style && <span aria-hidden className="text-xs">{style.mark}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Reviews({ data }: { data: PanelData }) {
  const { pending, run } = useRun();
  const [prompt, setPrompt] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => addReview(data.taskGid, prompt), () => setPrompt(""));
  };
  return (
    <section aria-label="Recall later">
      <h3 className="font-semibold">Recall later</h3>
      <p className="mt-1 text-xs text-neutral-400">
        {data.completed ? "Scheduled now that this is finished." : "These start the day after you finish this."}
      </p>
      <ul className="mt-2 space-y-1.5">
        {data.reviews.map((r) => (
          <li key={r.gid} className="group flex items-start justify-between gap-3 text-sm">
            <span>
              {r.prompt}
              {r.dueOn && <span className="ml-2 text-xs text-neutral-400">{r.dueOn}</span>}
            </span>
            <button
              onClick={() => run(() => removeReview(r.gid))}
              disabled={pending}
              aria-label={`Delete review: ${r.prompt}`}
              className="cursor-pointer px-1 text-xs text-neutral-400 hover:text-white md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-1 flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Add something to recall"
          aria-label="New review prompt"
          maxLength={500}
          className="min-h-9 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm placeholder-neutral-400 hover:border-white/10 focus:border-white/20"
        />
        {prompt.trim() && <button disabled={pending} className="btn-ghost px-3 py-1 text-xs">Add</button>}
      </form>
    </section>
  );
}
