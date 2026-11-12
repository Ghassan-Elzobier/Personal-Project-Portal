"use client";

import { useActionState, useState } from "react";
import type { ProjectKey } from "@/lib/config/projects";
import { STATUS_TYPES, type StatusType } from "@/lib/tasks/session-log";
import { postStatusUpdate, type PostState } from "./actions";

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
}: {
  project: ProjectKey;
  draft: string;
  suggested: StatusType;
  postedText: string | null;
}) {
  const alreadyPosted = postedText !== null;
  const [state, action, pending] = useActionState<PostState, FormData>(postStatusUpdate, {});
  const [status, setStatus] = useState<StatusType>(suggested in STATUS_TYPES ? suggested : "on_track");
  const [text, setText] = useState(draft);
  const [open, setOpen] = useState(!alreadyPosted);

  if (state.posted) {
    return <p className="rounded-xl bg-mint/10 p-4 text-sm text-mint ring-1 ring-mint/30">Posted. Mentors will see it now.</p>;
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl bg-white/5 p-4 text-sm whitespace-pre-line text-neutral-300">{postedText}</p>
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
              className={`btn px-4 py-1.5 ring-1 ${status === s ? STATUS_STYLE[s] : "bg-white/5 text-neutral-400 ring-white/10 hover:bg-white/10"}`}
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
          onChange={(e) => setText(e.target.value)}
          className="field-input font-mono text-[13px] leading-relaxed"
        />
      </label>
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
