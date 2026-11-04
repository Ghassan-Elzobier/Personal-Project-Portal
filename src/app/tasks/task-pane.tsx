"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Hours } from "@/components/ui";
import { STAGES } from "@/lib/tasks/session-log";
import { commentOnTask, editTask, removeTask, setTaskCompleted, setTaskStage, type ActionResult } from "./actions";

type PaneTask = {
  gid: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  stage: string;
  hours: number;
  evidence: string | null;
  milestone: boolean;
  notes: string;
  sectionGid: string | null;
};

/** The whole task, in a panel over the right of the page, as Asana opens one. */
export function TaskPane({
  task,
  sections,
  comments,
  closeHref,
  loadError,
  timeZone,
}: {
  task: PaneTask;
  sections: { gid: string; name: string }[];
  comments: { gid: string; text: string; createdAt: string }[];
  closeHref: string;
  loadError: string | null;
  /** The portal's zone, so the server and the browser print the same time. */
  timeZone: string;
}) {
  const stamp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(task.name);
  const [notes, setNotes] = useState(task.notes);
  const [dueOn, setDueOn] = useState(task.dueOn ?? "");
  const [section, setSection] = useState(task.sectionGid ?? "");
  const [evidence, setEvidence] = useState(task.evidence ?? "");
  const [comment, setComment] = useState("");
  const [completed, showCompleted] = useOptimistic(task.completed);
  const [stage, showStage] = useOptimistic(task.stage);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  const run = (action: () => Promise<ActionResult>, then?: () => void) =>
    start(async () => {
      setSaved(false);
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) then?.();
    });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => editTask(task.gid, { name, notes, dueOn, section, evidence }), () => setSaved(true));
  };
  const addComment = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => commentOnTask(task.gid, comment), () => setComment(""));
  };
  const remove = () => {
    if (window.confirm(`Delete "${task.name}" and its comments? This cannot be undone.`)) {
      run(() => removeTask(task.gid), () => router.push(closeHref, { scroll: false }));
    }
  };

  return (
    <aside aria-label={`Task: ${task.name}`} className="fixed inset-y-0 right-0 z-30 w-full max-w-xl space-y-6 overflow-y-auto bg-navy p-6 shadow-2xl ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={completed}
            disabled={pending}
            onChange={(e) => {
              const done = e.target.checked;
              run(() => {
                showCompleted(done);
                return setTaskCompleted(task.gid, done);
              });
            }}
            className="h-4 w-4 cursor-pointer accent-mint"
          />
          {completed ? "Completed" : "Mark complete"}
        </label>
        <Link href={closeHref} scroll={false} className="btn-ghost px-4 py-1.5">Close</Link>
      </div>

      {loadError && <p className="text-sm text-coral" role="alert">{loadError}</p>}
      {error && <p className="text-sm text-coral" role="alert">{error}</p>}

      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="task-name">{task.milestone ? "Milestone" : "Task"}</label>
          <input id="task-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={500} className="field-input" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="task-stage">Stage</label>
            <select
              id="task-stage"
              value={stage}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value;
                run(() => {
                  showStage(next);
                  return setTaskStage(task.gid, next);
                });
              }}
              className="field-input"
            >
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="task-due">Due</label>
            <input id="task-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="field-input" />
          </div>
          <div>
            <label className="field-label" htmlFor="task-section">Section</label>
            <select id="task-section" value={section} onChange={(e) => setSection(e.target.value)} className="field-input">
              <option value="">No section</option>
              {sections.map((s) => <option key={s.gid} value={s.gid}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <p className="field-label">Hours logged</p>
            <p className="mt-2 flex min-h-10 items-center justify-between gap-3 text-sm">
              <Hours value={task.hours} />
              <Link href={`/log?task=${task.gid}`} className="text-aqua underline-offset-4 hover:underline">Log a session</Link>
            </p>
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="task-evidence">Evidence link</label>
          <input id="task-evidence" type="url" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={2000} placeholder="https://" className="field-input" />
        </div>
        <div>
          <label className="field-label" htmlFor="task-notes">Description</label>
          <textarea id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} maxLength={20000} className="field-input" />
        </div>
        <div className="flex items-center gap-3">
          <button disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save changes"}</button>
          {saved && <span className="text-sm text-mint" role="status">Saved</span>}
        </div>
      </form>

      <section aria-label="Comments" className="space-y-3 border-t border-white/10 pt-5">
        <h3 className="font-semibold">Comments</h3>
        {comments.length === 0 && <p className="text-sm text-neutral-400">No comments yet. Logged sessions appear here.</p>}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.gid} className="rounded-xl bg-white/5 p-3">
              <p className="text-xs text-neutral-500">{stamp.format(new Date(c.createdAt))}</p>
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.text}</p>
            </li>
          ))}
        </ul>
        <form onSubmit={addComment} className="space-y-2">
          <label className="sr-only" htmlFor="task-comment">Add a comment</label>
          <textarea id="task-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={10000} placeholder="Add a comment" className="field-input" />
          <button disabled={pending || !comment.trim()} className="btn-ghost px-4 py-1.5">Comment</button>
        </form>
      </section>

      <div className="border-t border-white/10 pt-5">
        <button onClick={remove} disabled={pending} className="cursor-pointer text-sm text-coral hover:underline disabled:opacity-50">Delete task</button>
      </div>
    </aside>
  );
}
