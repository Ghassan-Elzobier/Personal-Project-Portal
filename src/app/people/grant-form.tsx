"use client";

import { useActionState } from "react";
import { PROJECTS } from "@/lib/config/projects";
import { grantMentor, type PeopleState } from "./actions";

export function GrantForm() {
  const [state, action, pending] = useActionState<PeopleState, FormData>(grantMentor, {});
  return (
    <form action={action} className="card space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
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
      {state.error && <p className="text-sm text-coral">{state.error}</p>}
      {state.ok && <p className="text-sm text-mint">{state.ok}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save mentor"}
      </button>
    </form>
  );
}
