"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { StartSessionButton } from "@/components/session-timer";
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

/** The whole task, in a panel over the right of the page. Every change saves itself. */
export function TaskPane({
  task,
  sections,
  comments,
  closeHref,
  loadError,
  timeZone,
  children,
}: {
  task: PaneTask;
  sections: { gid: string; name: string }[];
  comments: { gid: string; text: string; createdAt: string }[];
  closeHref: string;
  loadError: string | null;
  /** The portal's zone, so the server and the browser print the same time. */
  timeZone: string;
  /** More about the task, such as its steps and exercises. */
  children?: ReactNode;
}) {
  const stamp = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(task.name);
  const [notes, setNotes] = useState(task.notes);
  const [evidence, setEvidence] = useState(task.evidence ?? "");
  const [comment, setComment] = useState("");
  const [completed, showCompleted] = useOptimistic(task.completed);
  const [stage, showStage] = useOptimistic(task.stage);
  const [dueOn, showDueOn] = useOptimistic(task.dueOn ?? "");
  const [section, showSection] = useOptimistic(task.sectionGid ?? "");
  const panel = useRef<HTMLElement>(null);
  const close = () => router.push(closeHref, { scroll: false });

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  const run = (action: () => Promise<ActionResult>, then?: () => void) =>
    start(async () => {
      setStatus("saving");
      const result = await action();
      setError(result.error ?? null);
      setStatus(result.error ? "idle" : "saved");
      if (!result.error) then?.();
    });

  const saveField = (changes: Parameters<typeof editTask>[1]) => run(() => editTask(task.gid, changes));

  const addComment = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () => commentOnTask(task.gid, comment),
      () => setComment(""),
    );
  };
  const remove = () => {
    if (window.confirm(`Delete "${task.name}" and its comments? This cannot be undone.`)) {
      run(() => removeTask(task.gid), close);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-primary/50 lg:bg-transparent" onClick={close} aria-hidden />
      <aside
        ref={panel}
        tabIndex={-1}
        aria-label={`Task: ${task.name}`}
        className="fixed inset-y-0 right-0 z-40 w-full max-w-xl space-y-5 overflow-y-auto bg-navy p-6 pb-24 shadow-2xl ring-1 ring-white/10 focus:outline-none md:pb-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={completed}
              disabled={pending}
              aria-busy={pending}
              onChange={(e) => {
                const done = e.target.checked;
                run(() => {
                  showCompleted(done);
                  return setTaskCompleted(task.gid, done);
                });
              }}
              className="h-5 w-5 cursor-pointer accent-mint"
            />
            {completed ? "Completed" : "Mark complete"}
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-400" role="status">
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
            </span>
            <Link href={closeHref} scroll={false} className="btn-ghost px-4 py-1.5">
              Close
            </Link>
          </div>
        </div>

        {loadError && (
          <p className="text-sm text-coral" role="alert">
            {loadError}
          </p>
        )}
        {error && (
          <p className="text-sm text-coral" role="alert">
            {error}
          </p>
        )}

        <div>
          <label className="sr-only" htmlFor="task-name">
            {task.milestone ? "Milestone" : "Task"} name
          </label>
          <textarea
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== task.name && saveField({ name })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            rows={Math.min(3, Math.ceil(name.length / 42) || 1)}
            maxLength={500}
            className="w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold hover:border-white/10 focus:border-white/20"
          />
          {task.milestone && <p className="px-2 text-xs text-lavender">◆ Milestone</p>}
        </div>

        {children}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="task-stage">
              Stage
            </label>
            <select
              id="task-stage"
              value={stage}
              disabled={pending}
              aria-busy={pending}
              onChange={(e) => {
                const next = e.target.value;
                run(() => {
                  showStage(next);
                  return setTaskStage(task.gid, next);
                });
              }}
              className="field-input"
            >
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="task-due">
              Due
            </label>
            <input
              id="task-due"
              type="date"
              value={dueOn}
              onChange={(e) => {
                const next = e.target.value;
                run(() => {
                  showDueOn(next);
                  return editTask(task.gid, { dueOn: next });
                });
              }}
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="task-section">
              Section
            </label>
            <select
              id="task-section"
              value={section}
              onChange={(e) => {
                const next = e.target.value;
                run(() => {
                  showSection(next);
                  return editTask(task.gid, { section: next });
                });
              }}
              className="field-input"
            >
              <option value="">No section</option>
              {sections.map((s) => (
                <option key={s.gid} value={s.gid}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="field-label">Hours logged</p>
            <div className="mt-2 flex min-h-10 flex-wrap items-center gap-2 text-sm">
              <span className="mr-auto">
                <Hours value={task.hours} />
              </span>
              {!completed && (
                <StartSessionButton gid={task.gid} name={task.name} className="btn-ghost px-3 py-1 text-xs" />
              )}
              <Link href={`/log?task=${task.gid}`} className="btn-ghost px-3 py-1 text-xs">
                Log
              </Link>
            </div>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="task-evidence">
            Evidence link
          </label>
          <input
            id="task-evidence"
            type="url"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            onBlur={() => evidence.trim() !== (task.evidence ?? "") && saveField({ evidence })}
            maxLength={2000}
            placeholder="https://"
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="task-notes">
            Description
          </label>
          <textarea
            id="task-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== task.notes && saveField({ notes })}
            rows={4}
            maxLength={20000}
            placeholder="What done looks like, page numbers, links."
            className="field-input"
          />
        </div>

        <section aria-label="Comments" className="space-y-3 border-t border-white/10 pt-5">
          <h3 className="font-semibold">Comments</h3>
          {comments.length === 0 && (
            <p className="text-sm text-neutral-400">No comments yet. Logged sessions appear here.</p>
          )}
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.gid} className="rounded-xl bg-white/5 p-3">
                <p className="text-xs text-neutral-400">{stamp.format(new Date(c.createdAt))}</p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{c.text}</p>
              </li>
            ))}
          </ul>
          <form onSubmit={addComment} className="space-y-2">
            <label className="sr-only" htmlFor="task-comment">
              Add a comment
            </label>
            <textarea
              id="task-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={10000}
              placeholder="Add a comment"
              className="field-input"
            />
            <button disabled={pending || !comment.trim()} aria-busy={pending} className="btn-ghost px-4 py-1.5">
              Comment
            </button>
          </form>
        </section>

        <div className="border-t border-white/10 pt-5">
          <button
            onClick={remove}
            disabled={pending}
            aria-busy={pending}
            className="cursor-pointer text-sm text-coral hover:underline disabled:opacity-50"
          >
            Delete task
          </button>
        </div>
      </aside>
    </>
  );
}
