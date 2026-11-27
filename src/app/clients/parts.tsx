"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import { ActionButton } from "@/app/life/kit";
import { toast } from "@/components/toaster";
import { Fold } from "@/components/ui";
import {
  CHANNEL_MAX,
  MILESTONE_MAX,
  NAME_MAX,
  NOTES_MAX,
  PRICING_LABELS,
  PRICINGS,
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
  STAGE_LABELS,
  STAGES,
  TITLE_MAX,
  type Stage,
} from "@/lib/clients/clients";
import {
  addClient,
  addMilestone,
  addProject,
  markMilestone,
  removeRecord,
  saveProjectDetails,
  setStage,
} from "./actions";

// The Clients page's controls: the forms that add a client, a project or a
// milestone, a project's stage, its links and notes, and each milestone's
// buttons. Everything else on the page is drawn on the server.

const SELECT = "min-h-11 rounded-md border border-white/10 bg-white/10 px-3 text-sm text-bright";

export function AddClient() {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("referral");
  const [channel, setChannel] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await addClient(name, relationship, channel);
      if (r.error !== undefined) return void toast(r.error, { tone: "error" });
      setName("");
      setRelationship("referral");
      setChannel("");
      toast("Client added.");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 card">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="block">
          <span className="field-label">Client name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={NAME_MAX}
            autoComplete="off"
            className="field-input"
          />
        </label>
        <label className="block">
          <span className="field-label">How you know them</span>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className="field-input">
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="field-label">Where you talk</span>
        <input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          maxLength={CHANNEL_MAX}
          placeholder="WhatsApp, email… (optional)"
          autoComplete="off"
          className="field-input"
        />
      </label>
      <button className="btn-primary" disabled={pending} aria-busy={pending}>
        {pending ? "Adding…" : "Add client"}
      </button>
    </form>
  );
}

export function AddProject({ clientGid, clientName }: { clientGid: string; clientName: string }) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [pricing, setPricing] = useState("fixed");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await addProject(clientGid, title, pricing);
      if (r.error !== undefined) return void toast(r.error, { tone: "error" });
      setTitle("");
      setPricing("fixed");
      toast("Project added.");
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-0 flex-1 basis-56">
        <span className="field-label">New project</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={TITLE_MAX}
          autoComplete="off"
          aria-label={`New project for ${clientName}`}
          className="field-input"
        />
      </label>
      <label className="block">
        <span className="field-label">Pricing</span>
        <select
          value={pricing}
          onChange={(e) => setPricing(e.target.value)}
          aria-label={`Pricing for ${clientName}'s new project`}
          className={`mt-2 block ${SELECT}`}
        >
          {PRICINGS.map((p) => (
            <option key={p} value={p}>
              {PRICING_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <button className="btn-ghost" disabled={pending} aria-busy={pending}>
        {pending ? "Adding…" : "Add project"}
      </button>
    </form>
  );
}

/** A project's stage, changed in one pick. The page shows the new stage at once. */
export function StageSelect({ gid, title, stage }: { gid: string; title: string; stage: Stage }) {
  const [pending, start] = useTransition();
  const [shown, show] = useOptimistic(stage);

  const pick = (next: Stage) =>
    start(async () => {
      show(next);
      const r = await setStage(gid, next);
      toast(r.error ?? `Moved to ${STAGE_LABELS[next].toLowerCase()}.`, r.error ? { tone: "error" } : {});
    });

  return (
    <select
      value={shown}
      onChange={(e) => pick(e.target.value as Stage)}
      disabled={pending}
      aria-busy={pending}
      aria-label={`Stage of ${title}`}
      className={`shrink-0 ${SELECT}`}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export function AddMilestone({ projectGid, projectTitle }: { projectGid: string; projectTitle: string }) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [amount, setAmount] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await addMilestone(projectGid, title, dueOn, amount);
      if (r.error !== undefined) return void toast(r.error, { tone: "error" });
      setTitle("");
      setDueOn("");
      setAmount("");
      toast("Milestone added.");
    });
  };

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
    >
      <label className="block">
        <span className="field-label">New milestone</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={MILESTONE_MAX}
          autoComplete="off"
          aria-label={`New milestone for ${projectTitle}`}
          className="field-input"
        />
      </label>
      <label className="block">
        <span className="field-label">Due</span>
        <input
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
          aria-label={`Due day of the new milestone for ${projectTitle}`}
          className="field-input"
        />
      </label>
      <label className="block">
        <span className="field-label">Amount (£)</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="Optional"
          autoComplete="off"
          aria-label={`Amount in pounds of the new milestone for ${projectTitle}`}
          className="field-input"
        />
      </label>
      <button className="btn-ghost" disabled={pending} aria-busy={pending}>
        {pending ? "Adding…" : "Add milestone"}
      </button>
    </form>
  );
}

/** A milestone's buttons: accepted by the client, paid, and delete. */
export function MilestoneButtons({
  gid,
  title,
  accepted,
  paid,
}: {
  gid: string;
  title: string;
  accepted: boolean;
  paid: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        action={() => markMilestone(gid, "accepted", !accepted)}
        pressed={accepted}
        label={`Accepted: ${title}`}
        done={accepted ? "No longer accepted." : "Marked accepted."}
        className={`tap px-3 text-xs font-medium ring-1 ${accepted ? "bg-lilac/20 text-lilac ring-lilac/40" : "bg-white/5 text-body ring-white/10"}`}
      >
        Accepted
      </ActionButton>
      <ActionButton
        action={() => markMilestone(gid, "paid", !paid)}
        pressed={paid}
        label={`Paid: ${title}`}
        done={paid ? "No longer paid." : "Marked paid."}
        className={`tap px-3 text-xs font-medium ring-1 ${paid ? "bg-mint/20 text-mint ring-mint/40" : "bg-white/5 text-body ring-white/10"}`}
      >
        Paid
      </ActionButton>
      <ActionButton
        action={() => removeRecord("milestone", gid)}
        confirm="Delete this milestone for good?"
        done="Deleted."
        label={`Delete milestone ${title}`}
        className="tap shrink-0 text-xl leading-none text-muted hover:text-bright"
      >
        <span aria-hidden>×</span>
      </ActionButton>
    </div>
  );
}

/** A project's repo, preview and live links and its notes, folded away until needed. */
export function ProjectDetails({
  gid,
  title,
  repoUrl,
  previewUrl,
  liveUrl,
  notes,
}: {
  gid: string;
  title: string;
  repoUrl: string | null;
  previewUrl: string | null;
  liveUrl: string | null;
  notes: string | null;
}) {
  const [pending, start] = useTransition();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    start(async () => {
      const r = await saveProjectDetails(gid, {
        repoUrl: field("repo"),
        previewUrl: field("preview"),
        liveUrl: field("live"),
        notes: field("notes"),
      });
      toast(r.error ?? "Saved.", r.error ? { tone: "error" } : {});
    });
  };

  const link = (name: string, label: string, value: string | null) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        name={name}
        type="url"
        defaultValue={value ?? ""}
        placeholder="https://…"
        aria-label={`${label} link for ${title}`}
        className="field-input"
      />
    </label>
  );

  return (
    <Fold title="Links and notes" className="min-w-0 flex-1">
      <form onSubmit={submit} className="mt-2 space-y-3">
        {link("repo", "Repo", repoUrl)}
        {link("preview", "Preview", previewUrl)}
        {link("live", "Live", liveUrl)}
        <label className="block">
          <span className="field-label">Notes</span>
          <textarea
            name="notes"
            defaultValue={notes ?? ""}
            maxLength={NOTES_MAX}
            rows={3}
            aria-label={`Notes for ${title}`}
            className="field-input"
          />
        </label>
        <button className="btn-ghost" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save links and notes"}
        </button>
      </form>
    </Fold>
  );
}

/** Deletes a client or a project, after asking. */
export function RemoveButton({
  kind,
  gid,
  label,
  confirm,
}: {
  kind: "client" | "project";
  gid: string;
  label: string;
  confirm: string;
}) {
  return (
    <ActionButton
      action={() => removeRecord(kind, gid)}
      confirm={confirm}
      done="Deleted."
      label={label}
      className="tap px-3 text-xs text-muted hover:text-bright"
    >
      Delete
    </ActionButton>
  );
}
