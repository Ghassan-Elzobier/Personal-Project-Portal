"use client";

import { useActionState } from "react";
import { PROJECTS } from "@/lib/config/projects";
import { grantMentor, type PeopleState } from "./actions";

export function GrantForm() {
  const [state, action, pending] = useActionState<PeopleState, FormData>(grantMentor, {});
  return (
    <form action={action} className="space-y-5 card p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Email</span>
          <input name="email" type="email" required className="field-input" autoComplete="off" />
        </label>
        <label className="block">
          <span className="field-label">Name</span>
          <input name="name" required maxLength={80} className="field-input" autoComplete="off" />
        </label>
      </div>
      <fieldset>
        <legend className="field-label">Projects they can see</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PROJECTS.map((p) => (
            <label key={p.key} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm">
              <input type="checkbox" name="projects" value={p.key} className="accent-lavender" />
              <span>
                {p.title} <span className="text-neutral-400">· {p.area}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="field-label">Also share</legend>
        <label className="mt-2 flex items-start gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm">
          <input type="checkbox" name="share_job_hunt" className="mt-1 accent-lavender" />
          <span>
            Job hunt{" "}
            <span className="text-neutral-400">
              · closest roles, the skills gap and application counts. Never your notes, next actions, ratings or
              contacts.
            </span>
          </span>
        </label>
        <p className="mt-2 text-xs text-neutral-400">
          The study roadmap follows the projects above: a mentor sees the plans they can see.
        </p>
      </fieldset>
      {state.error && <p className="text-sm text-coral">{state.error}</p>}
      {state.ok && <p className="text-sm text-mint">{state.ok}</p>}
      <button className="btn-primary" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save mentor"}
      </button>
    </form>
  );
}
