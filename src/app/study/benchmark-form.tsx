"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "@/components/toaster";
import { GPUS, METRICS, type BenchmarkRow } from "@/lib/study/benchmarks";
import type { RepoCommit } from "@/lib/study/github";
import { addBenchmark, removeBenchmark } from "./actions";

export function BenchmarkForm({
  project,
  commits,
  units,
  defaultTask,
  last,
}: {
  project: string;
  commits: RepoCommit[];
  units: { gid: string; name: string }[];
  defaultTask: string;
  last: BenchmarkRow | null;
}) {
  const [metric, setMetric] = useState(last?.metric ?? METRICS[0].name);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(last?.unit ?? METRICS[0].unit);
  // The same scene and GPU are the common case, and only those can be compared.
  const [scene, setScene] = useState(last?.scene ?? "");
  const [gpu, setGpu] = useState(last?.gpu ?? "");
  const [commit, setCommit] = useState(commits[0]?.sha.slice(0, 7) ?? "");
  const [notes, setNotes] = useState("");
  const [task, setTask] = useState(defaultTask);
  const [pending, start] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await addBenchmark({
        project,
        task: task || null,
        metric,
        value: Number(value),
        unit,
        scene,
        gpu,
        commit,
        notes,
      });
      if (result.error) toast(result.error, { tone: "error" });
      else {
        setValue("");
        setNotes("");
        toast("Result saved.");
      }
    });
  };
  const input = "field-input mt-1";
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 card sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label htmlFor="bench-metric" className="field-label">
          Measured
        </label>
        <input
          id="bench-metric"
          className={input}
          list="metric-names"
          value={metric}
          required
          maxLength={80}
          onChange={(e) => {
            setMetric(e.target.value);
            const known = METRICS.find((m) => m.name === e.target.value);
            if (known) setUnit(known.unit);
          }}
        />
        <datalist id="metric-names">
          {METRICS.map((m) => (
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="bench-value" className="field-label">
          Value
        </label>
        <input
          id="bench-value"
          className={input}
          type="number"
          step="any"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="bench-unit" className="field-label">
          Unit
        </label>
        <input
          id="bench-unit"
          className={input}
          value={unit}
          maxLength={20}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="bench-commit" className="field-label">
          Commit
        </label>
        <input
          id="bench-commit"
          className={input}
          list="repo-commits"
          value={commit}
          maxLength={40}
          placeholder="Hash"
          onChange={(e) => setCommit(e.target.value)}
        />
        <datalist id="repo-commits">
          {commits.map((c) => (
            <option key={c.sha} value={c.sha.slice(0, 7)}>
              {c.message}
            </option>
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="bench-scene" className="field-label">
          Scene
        </label>
        <input
          id="bench-scene"
          className={input}
          value={scene}
          maxLength={120}
          placeholder="Four spheres, 1280×720"
          onChange={(e) => setScene(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="bench-gpu" className="field-label">
          GPU
        </label>
        <input
          id="bench-gpu"
          className={input}
          list="gpu-names"
          value={gpu}
          maxLength={80}
          placeholder={GPUS[0]}
          onChange={(e) => setGpu(e.target.value)}
        />
        <datalist id="gpu-names">
          {GPUS.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="bench-task" className="field-label">
          Milestone
        </label>
        <select id="bench-task" className={input} value={task} onChange={(e) => setTask(e.target.value)}>
          <option value="">None</option>
          {units.map((u) => (
            <option key={u.gid} value={u.gid}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="bench-notes" className="field-label">
          Notes
        </label>
        <input
          id="bench-notes"
          className={input}
          value={notes}
          maxLength={1000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <button disabled={pending || !value} aria-busy={pending} className="btn-primary px-4 py-1.5">
          {pending ? "Saving…" : "Save result"}
        </button>
      </div>
    </form>
  );
}

export function BenchmarkHistory({ rows }: { rows: BenchmarkRow[] }) {
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-neutral-300 hover:text-white">All {rows.length} results</summary>
      <ul className="mt-2 divide-y divide-white/5">
        {[...rows].reverse().map((r) => (
          <li key={r.gid} className="flex flex-wrap items-center justify-between gap-3 py-2 text-neutral-300">
            <span>
              {r.created_at.slice(0, 10)}: {r.metric} {Number(r.value)} {r.unit}
              {r.notes && <span className="text-neutral-400"> ({r.notes})</span>}
            </span>
            <button
              disabled={pending}
              aria-busy={pending}
              aria-label={`Delete result from ${r.created_at.slice(0, 10)}: ${r.metric}`}
              className="cursor-pointer text-xs text-neutral-400 hover:text-white"
              onClick={() =>
                start(async () => {
                  const result = await removeBenchmark(r.gid);
                  if (result.error) toast(result.error, { tone: "error" });
                })
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
