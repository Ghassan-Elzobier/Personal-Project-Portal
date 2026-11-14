"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "@/components/toaster";
import { shortDate } from "@/lib/dates/week";
import { BANDS, type RequirementView, type SkillStatus } from "@/lib/jobs/match";
import type { RoleView } from "@/lib/jobs/load";
import { LEVELS } from "@/lib/jobs/skills";
import { setTracking } from "./actions";

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

/** One role: how you match it, what you decided and what is next. Every change saves itself. */
export function RolePane({
  role,
  body,
  events,
  closeHref,
  loadError,
}: {
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
        </div>

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
                <button
                  key={option.value}
                  type="button"
                  disabled={pending}
                  aria-busy={pending}
                  aria-pressed={interest === option.value}
                  onClick={() => {
                    const next = interest === option.value ? null : option.value;
                    setInterest(next);
                    save({ interest: next });
                  }}
                  className={`rounded-full px-3 py-1 text-xs ring-1 transition ${interest === option.value ? "bg-lavender/30 text-white ring-lavender" : "bg-white/5 text-body ring-white/10 hover:ring-white/30"}`}
                >
                  {option.label}
                </button>
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
            unstated
              ? "This advert does not separate requirements from duties, so these are read from what it says the job involves."
              : undefined
          }
          items={role.fit.must}
        />
        <Requirements title="Also wanted, or part of the job" items={role.fit.soft} />
        {!role.has_body && (
          <p className="text-sm text-body">
            The advert text is not on file. Open the advert, or add it again by hand with its text, to compare it.
          </p>
        )}

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
