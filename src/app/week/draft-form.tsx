"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { ErrorNote } from "@/components/ui";
import type { ProjectKey } from "@/lib/config/projects";
import { STATUS_TYPES, type StatusType } from "@/lib/tasks/session-log";
import { polishWeeklyUpdate, postStatusUpdate, type PostState } from "./actions";

const STATUS_STYLE: Record<StatusType, string> = {
  on_track: "bg-mint/20 text-mint ring-mint/40",
  at_risk: "bg-sand/20 text-sand ring-sand/40",
  off_track: "bg-coral/20 text-coral ring-coral/40",
};

export function DraftForm({
  project,
  draft,
  suggested,
  postedText,
  canPolish = false,
}: {
  project: ProjectKey;
  draft: string;
  suggested: StatusType;
  postedText: string | null;
  /** Claude can write the Done line up: the portal can ask it, and this week's sessions have notes. */
  canPolish?: boolean;
}) {
  const alreadyPosted = postedText !== null;
  const [state, action, pending] = useActionState<PostState, FormData>(postStatusUpdate, {});
  const [status, setStatus] = useState<StatusType>(suggested in STATUS_TYPES ? suggested : "on_track");
  const [text, setText] = useState(draft);
  const [open, setOpen] = useState(!alreadyPosted);
  const [polishing, startPolish] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const polish = () =>
    startPolish(async () => {
      setProblem(null);
      const before = text;
      const result = await polishWeeklyUpdate(project, before);
      if (result.error !== undefined || result.text === undefined)
        return setProblem(result.error ?? "Claude couldn't write this week up.");
      setText(result.text);
      toast("Claude wrote the Done line from your session notes. Read it before you post.", {
        action: { label: "Undo", onClick: () => setText(before) },
      });
    });

  if (state.posted) {
    return (
      <p className="rounded-xl bg-mint/10 p-4 text-sm text-mint ring-1 ring-mint/30">
        Posted. Mentors will see it now.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl bg-white/5 p-4 text-sm whitespace-pre-line text-body">{postedText}</p>
        <button className="btn-ghost" onClick={() => setOpen(true)}>
          Post another update
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="project" value={project} />
      <input type="hidden" name="status" value={status} />
      {alreadyPosted && <input type="hidden" name="force" value="yes" />}
      <fieldset>
        <legend className="field-label">Status</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(STATUS_TYPES) as StatusType[]).map((s) => (
            <button
              type="button"
              key={s}
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setText((t) => t.replace(/^Status: .*$/m, `Status: ${STATUS_TYPES[s]}`));
              }}
              className={`btn px-4 py-1.5 ring-1 ${status === s ? STATUS_STYLE[s] : "bg-white/5 text-muted ring-white/10 hover:bg-white/10"}`}
            >
              {STATUS_TYPES[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="field-label">Update</span>
        <textarea
          name="text"
          rows={7}
          value={text}
          readOnly={polishing}
          aria-busy={polishing}
          onChange={(e) => setText(e.target.value)}
          className="field-input font-mono leading-relaxed"
        />
      </label>
      {canPolish && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            disabled={polishing}
            aria-busy={polishing}
            onClick={polish}
            className="btn-ghost min-h-11 shrink-0 px-4 text-sm"
          >
            {polishing ? "Writing it up…" : "Write up from my notes"}
          </button>
          <p className="min-w-0 flex-1 basis-56 text-xs text-body">
            Claude rewrites the Done line from this week&apos;s session notes. Nothing is posted until you post it.
          </p>
        </div>
      )}
      {problem && <ErrorNote message={problem} />}
      {state.error && (
        <p className="text-sm text-coral" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn-primary" disabled={pending} aria-busy={pending}>
        {pending ? "Posting…" : "Post update"}
      </button>
    </form>
  );
}
