"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "@/components/toaster";
import { ToggleChip } from "@/components/ui";
import { shortDate } from "@/lib/dates/week";
import { BANDS, type RequirementView, type SkillStatus } from "@/lib/jobs/match";
import type { RoleView } from "@/lib/jobs/load";
import { LEVELS } from "@/lib/jobs/skills";
import { editRoleDetails, readRoleAdvert, setTracking } from "./actions";

const INTEREST = [
  { value: 0, label: "Not for me" },
  { value: 1, label: "Maybe" },
  { value: 2, label: "Want" },
  { value: 3, label: "Really want" },
];
const STAGES = [
  { value: "new", label: "Not decided" },
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "passed", label: "Passed on" },
];
const DOT: Record<SkillStatus, string> = {
  evidenced: "bg-mint",
  in_plan: "bg-aqua",
  near: "bg-sand",
  missing: "bg-coral",
};
const field = "min-h-9 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm";

function Standing({ view }: { view: RequirementView }) {
  const { standing } = view;
  if (standing.status === "evidenced") {
    const top = standing.evidence[0];
    return (
      <>
        {LEVELS[standing.level].name}:{" "}
        {top?.href ? (
          <a href={top.href} target={top.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="link">
            {top.label}
          </a>
        ) : (
          top?.label
        )}
      </>
    );
  }
  if (standing.status === "in_plan" && standing.next) {
    const when = standing.next.dueOn
      ? `by ${shortDate(standing.next.dueOn)}`
      : standing.next.phase !== null
        ? `phase ${standing.next.phase + 1}`
        : "not dated";
    return (
      <>
        In your plan:{" "}
        {standing.next.href ? (
          <Link href={standing.next.href} className="link">
            {standing.next.name}
          </Link>
        ) : (
          standing.next.name
        )}
        , {when}
        {standing.next.optional ? ", optional" : ""}
      </>
    );
  }
  return standing.nearName ? <>Not in your plan, but close to {standing.nearName}</> : <>Not in your plan</>;
}

function Requirements({ title, note, items }: { title: string; note?: string; items: RequirementView[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {note && <p className="mb-2 text-xs text-muted">{note}</p>}
      <ul className="space-y-3 text-sm">
        {items.map((item) => (
          <li key={item.skill} className="flex gap-2">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[item.status]}`} aria-hidden />
            <div className="min-w-0">
              <p>
                <span className="font-medium">{item.name}</span>
                {item.orElse.length > 0 && <span className="text-muted"> or {item.orElse.join(", ")}</span>}
              </p>
              <p className="text-xs text-body">
                <Standing view={item} />
              </p>
              <p className="mt-0.5 text-xs text-muted italic">“{item.quote}”</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Reads the advert of a role that has only a link, with its requirements, when the owner asks. */
function ReadAdvertButton({ gid }: { gid: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      className="btn-ghost px-4 py-1.5 text-sm"
      onClick={() =>
        start(async () => {
          const result = await readRoleAdvert(gid);
          if (result.error) return toast(result.error, { tone: "error" });
          const found = result.found ?? 0;
          toast(
            found
              ? `Read the advert: ${found} ${found === 1 ? "requirement" : "requirements"}${result.readBy === "claude" ? ", read by Claude" : ""}.`
              : "Read the advert. Nothing in it is on your skill list.",
          );
        })
      }
    >
      {pending ? "Reading the advert…" : "Read the advert"}
    </button>
  );
}

/**
 * The facts of a role you added yourself, to fix after a one-tap add. It opens on what
 * is saved now, and closes when the change is in; the pane above shows the saved values.
 */
function DetailsForm({ role, onDone }: { role: RoleView; onDone: () => void }) {
  const [form, setForm] = useState({
    title: role.title,
    company: role.company,
    location: role.location,
    url: role.url ?? "",
    salary: role.salary ?? "",
  });
  const [pending, start] = useTransition();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  const input = (key: keyof typeof form, label: string, extra: { type?: string; required?: boolean } = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold">{label}</span>
      <input value={form[key]} onChange={set(key)} className={field} {...extra} />
    </label>
  );
  return (
    <form
      aria-label="Edit details"
      className="space-y-2 rounded-xl bg-white/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await editRoleDetails(role.gid, form);
          if (result.error) return toast(result.error, { tone: "error" });
          toast("Details saved.");
          onDone();
        });
      }}
    >
      {input("title", "Role title", { required: true })}
      {input("company", "Employer", { required: true })}
      {input("location", "Location")}
      {input("url", "Link to the advert", { type: "url" })}
      {input("salary", "Salary")}
      <div className="flex flex-wrap gap-2 pt-1">
        <button disabled={pending} aria-busy={pending} className="btn-ghost px-4 py-1.5 text-sm">
          Save details
        </button>
        <button type="button" onClick={onDone} className="tap px-2 text-sm link">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One role: how you match it, what you decided and what is next. Every change saves itself. */
export function RolePane({
  role,
  body,
  events,
  closeHref,
  loadError,
  pay = [],
}: {
  /** What the salary would mean for the owner's money plan, in a few lines. */
  pay?: string[];
  role: RoleView;
  body: string;
  events: { stage: string; created_at: string }[];
  closeHref: string;
  loadError: string | null;
}) {
  const router = useRouter();
  const panel = useRef<HTMLElement>(null);
  const [pending, start] = useTransition();
  const [interest, setInterest] = useState(role.interest);
  const [stage, setStage] = useState<string>(role.stage);
  const [action, setAction] = useState(role.next_action);
  const [actionOn, setActionOn] = useState(role.next_action_on ?? "");
  const [notes, setNotes] = useState(role.notes);
  const [editing, setEditing] = useState(false);
  // A feed rewrites its own roles on every read, so only a role added by hand can be edited.
  const editable = role.source_kind === "manual";

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  const save = (patch: Parameters<typeof setTracking>[1]) =>
    start(async () => {
      const result = await setTracking(role.gid, patch);
      if (result.error) toast(result.error, { tone: "error" });
    });

  const unstated = role.fit.must.some((m) => m.level === "unstated");
  const flags: ReactNode[] = [];
  if (role.details.earlyCareer) flags.push("Open to early-career engineers");
  if (role.details.years) flags.push(`Asks for ${role.details.years}+ years`);
  if (role.details.clearance) flags.push("Needs security clearance or a nationality");
  if (role.details.noSponsorship) flags.push("Says it cannot sponsor a visa");
  if (role.seniority === "senior") flags.push("Senior level");
  if (role.seniority === "lead") flags.push("Lead level or above");

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-primary/50 lg:bg-transparent"
        onClick={() => router.push(closeHref, { scroll: false })}
        aria-hidden
      />
      <aside
        ref={panel}
        tabIndex={-1}
        aria-label={`Role: ${role.title}`}
        className="fixed inset-y-0 right-0 z-40 w-full max-w-xl space-y-5 overflow-y-auto bg-navy p-6 pb-24 shadow-2xl ring-1 ring-white/10 focus:outline-none md:pb-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{role.title}</h2>
            <p className="text-sm text-body">
              {role.company}, {role.location || "place not stated"}
              {role.alsoIn.length > 0 && <span className="text-muted">, also listed for {role.alsoIn.join("; ")}</span>}
            </p>
            {role.salary && <p className="text-sm text-body">{role.salary}</p>}
            {pay.length > 0 && (
              <div className="mt-1 space-y-0.5 text-xs text-muted tabular-nums">
                {pay.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </div>
          <Link href={closeHref} scroll={false} className="btn-ghost shrink-0 px-3 py-1 text-sm">
            Close
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {role.url && (
            <a href={role.url} target="_blank" rel="noreferrer" className="link">
              Open the advert
            </a>
          )}
          {role.closed_at && (
            <span className="text-coral">No longer listed since {shortDate(role.closed_at.slice(0, 10))}</span>
          )}
          {role.legacy_rating !== null && (
            <span className="text-muted">Rated {role.legacy_rating} in your old sheet</span>
          )}
          {editable && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="tap text-sm link">
              Edit details
            </button>
          )}
        </div>

        {editing && <DetailsForm role={role} onDone={() => setEditing(false)} />}

        <section className="rounded-xl bg-white/5 p-3">
          <p className="text-sm font-semibold">{BANDS[role.fit.band].name}</p>
          <p className="text-sm text-body">{role.fit.reason}</p>
          {role.fit.readyBy && (
            <p className="mt-1 text-sm text-aqua">
              Your plan reaches everything it needs by {shortDate(role.fit.readyBy)}.
            </p>
          )}
          {flags.length > 0 && <p className="mt-1 text-xs text-muted">{flags.join(". ")}.</p>}
        </section>

        <section className="space-y-3">
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">How much you want it</legend>
            <div className="flex flex-wrap gap-2">
              {INTEREST.map((option) => (
                <ToggleChip
                  key={option.value}
                  disabled={pending}
                  busy={pending}
                  pressed={interest === option.value}
                  onClick={() => {
                    const next = interest === option.value ? null : option.value;
                    setInterest(next);
                    save({ interest: next });
                  }}
                >
                  {option.label}
                </ToggleChip>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Stage</span>
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                save({ stage: e.target.value });
              }}
              className={field}
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">Next action</span>
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                onBlur={() => action !== role.next_action && save({ next_action: action })}
                placeholder="Ask X for a referral"
                className={field}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">By</span>
              <input
                type="date"
                value={actionOn}
                onChange={(e) => {
                  setActionOn(e.target.value);
                  save({ next_action_on: e.target.value || null });
                }}
                className={field}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== role.notes && save({ notes })}
              rows={3}
              className={field}
            />
          </label>
        </section>

        {loadError && <p className="text-sm text-coral">{loadError}</p>}

        <Requirements
          title="Requires"
          note={
            role.details.readBy === "claude"
              ? "Claude read these from the advert's own words, because the rules couldn't. Each quote is the advert's."
              : unstated
                ? "This advert does not separate requirements from duties, so these are read from what it says the job involves."
                : undefined
          }
          items={role.fit.must}
        />
        <Requirements title="Also wanted, or part of the job" items={role.fit.soft} />
        {!role.has_body &&
          (role.url ? (
            <div className="space-y-2 rounded-xl bg-white/5 p-3">
              <p className="text-sm text-body">
                The advert text is not on file yet, so this role can&apos;t be compared. The portal can read it from its
                link.
              </p>
              <ReadAdvertButton gid={role.gid} />
            </div>
          ) : (
            <p className="text-sm text-body">
              The advert text is not on file. Add it again by hand with its text to compare it.
            </p>
          ))}

        {events.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">History</h3>
            <ul className="space-y-1 text-xs text-body">
              {events.map((e, i) => (
                <li key={i}>
                  {shortDate(e.created_at.slice(0, 10))}: {STAGES.find((s) => s.value === e.stage)?.label ?? e.stage}
                </li>
              ))}
            </ul>
          </section>
        )}

        {body && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">The advert</summary>
            <p className="mt-2 text-xs text-muted">Kept as plain text, including after the role closes.</p>
            <p className="mt-2 text-sm whitespace-pre-wrap text-body">{body}</p>
          </details>
        )}
      </aside>
    </>
  );
}
