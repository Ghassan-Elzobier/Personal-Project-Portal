"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { logSession, type LogState } from "./actions";

export type TaskOption = {
  gid: string;
  name: string;
  project: string;
  stage: string | null;
  hours: number;
  evidence: string | null;
  completed: boolean;
  dueOn: string | null;
  stageOptions: string[];
};

const QUICK_HOURS = ["0.5", "1", "1.5", "2", "3"];

export function LogForm({ tasks, preselect }: { tasks: TaskOption[]; preselect: string | null }) {
  const [state, action, pending] = useActionState<LogState, FormData>(logSession, {});
  const initial = tasks.find((t) => t.gid === preselect) ?? tasks[0] ?? null;
  const [taskGid, setTaskGid] = useState(initial?.gid ?? "");
  const [hours, setHours] = useState("1");
  const task = tasks.find((t) => t.gid === taskGid) ?? null;
  const [stage, setStage] = useState(defaultStage(initial));
  const [formKey, setFormKey] = useState(0);

  const groups = useMemo(() => {
    const byProject = new Map<string, TaskOption[]>();
    for (const t of tasks) byProject.set(t.project, [...(byProject.get(t.project) ?? []), t]);
    return [...byProject.entries()];
  }, [tasks]);

  if (state.ok && formKey === 0) {
    return (
      <div className="card-special space-y-4" role="status">
        <p className="text-sm text-white/80">Logged</p>
        <p className="text-2xl font-bold">
          {state.ok.hours} h on {state.ok.task}
        </p>
        <p className="text-white/80">
          Total on this task is now {state.ok.total} h{state.ok.stage ? `, stage ${state.ok.stage}` : ""}.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn bg-white/15 hover:bg-white/25" onClick={() => setFormKey((k) => k + 1)}>
            Log another
          </button>
          <Link href="/" className="btn bg-white/15 hover:bg-white/25">
            Back to today
          </Link>
          <a href={state.ok.url} target="_blank" rel="noreferrer" className="btn bg-white/15 hover:bg-white/25">
            Open in Asana
          </a>
        </div>
      </div>
    );
  }

  if (!tasks.length) {
    return <p className="rounded-xl bg-white/5 p-4 text-sm text-neutral-400">No open tasks found in Asana.</p>;
  }

  return (
    <form
      key={formKey}
      action={(fd) => {
        setFormKey(0);
        return action(fd);
      }}
      className="card space-y-6 p-6"
    >
      <label className="block">
        <span className="field-label">Task</span>
        <select
          name="task"
          className="field-input"
          value={taskGid}
          onChange={(e) => {
            setTaskGid(e.target.value);
            setStage(defaultStage(tasks.find((t) => t.gid === e.target.value) ?? null));
          }}
          required
        >
          {groups.map(([project, items]) => (
            <optgroup key={project} label={project}>
              {items.map((t) => (
                <option key={t.gid} value={t.gid}>
                  {t.name}
                  {t.completed ? " (done)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {task && (
          <span className="mt-2 block text-xs text-neutral-500">
            {task.hours} h so far{task.stage ? ` · ${task.stage}` : ""}
            {task.evidence ? " · has evidence" : ""}
          </span>
        )}
      </label>

      <fieldset>
        <legend className="field-label">Hours this session</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {QUICK_HOURS.map((h) => (
            <button
              type="button"
              key={h}
              onClick={() => setHours(h)}
              aria-pressed={hours === h}
              className={`btn px-4 py-1.5 ring-1 ${hours === h ? "bg-lavender text-white ring-lavender" : "bg-white/5 text-neutral-300 ring-white/10 hover:bg-white/10"}`}
            >
              {h}
            </button>
          ))}
          <input
            name="hours"
            type="number"
            inputMode="decimal"
            min="0.25"
            max="16"
            step="0.25"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="field-input mt-0 w-24"
            aria-label="Hours"
            required
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">Stage after this session</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(task?.stageOptions ?? []).map((s) => (
            <label
              key={s}
              className={`btn cursor-pointer px-4 py-1.5 ring-1 ${stage === s ? "bg-lavender text-white ring-lavender" : "bg-white/5 text-neutral-300 ring-white/10 hover:bg-white/10"}`}
            >
              <input
                type="radio"
                name="stage"
                value={s}
                checked={stage === s}
                onChange={() => setStage(s)}
                className="sr-only"
              />
              {s}
            </label>
          ))}
        </div>
        {stage === "Done" && <p className="mt-2 text-xs text-mint">The task will be marked complete.</p>}
        {stage === "Needs review" && (
          <p className="mt-2 text-xs text-sand">Your Asana rule adds the mentor and asks them to review.</p>
        )}
      </fieldset>

      <label className="block">
        <span className="field-label">Evidence link</span>
        <input
          name="evidence"
          type="url"
          placeholder="https://github.com/…/commit/…"
          className="field-input"
          defaultValue=""
        />
        <span className="mt-2 block text-xs text-neutral-500">
          A commit, notes or exercise solutions. Replaces the task&apos;s current Evidence link.
        </span>
      </label>

      <label className="block">
        <span className="field-label">Notes</span>
        <textarea
          name="notes"
          rows={3}
          placeholder="What you did, what clicked, what didn't."
          className="field-input"
        />
      </label>

      {state.error && (
        <p className="text-sm text-coral" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn-primary w-full" disabled={pending || !taskGid}>
        {pending ? "Saving to Asana…" : `Log ${hours || 0} h`}
      </button>
    </form>
  );
}

function defaultStage(task: TaskOption | null): string {
  if (!task) return "In progress";
  if (!task.stage || task.stage === "Not started") return "In progress";
  return task.stage;
}
