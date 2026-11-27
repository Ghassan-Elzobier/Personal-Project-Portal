"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { ErrorNote } from "@/components/ui";
import {
  addEvidence,
  addRoleByHand,
  addRoleFromAdvert,
  addSource,
  markSourceChecked,
  refreshJobs,
  removeEvidence,
  setSourceActive,
} from "./actions";
import { startNavigation } from "@/components/navigation-progress";

const field = "min-h-9 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm";

function describe(result: Awaited<ReturnType<typeof refreshJobs>>): string {
  const parts = [`${result.added ?? 0} new ${result.added === 1 ? "role" : "roles"}`];
  if (result.closed) parts.push(`${result.closed} no longer listed`);
  if (result.failed?.length) parts.push(`could not read ${result.failed.join(", ")}`);
  return `Checked ${result.read ?? 0} sources: ${parts.join(", ")}.`;
}

/** Checks the feeds on request, and by itself when the last check is getting old. */
export function RefreshButton({ stale, hasSources }: { stale: boolean; hasSources: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const ran = useRef(false);
  const run = (quiet: boolean) =>
    start(async () => {
      const result = await refreshJobs();
      if (result.error) toast(result.error, { tone: "error" });
      else if (!quiet || result.added || result.failed?.length) toast(describe(result));
      router.refresh();
    });

  useEffect(() => {
    if (stale && hasSources && !ran.current) {
      ran.current = true;
      run(true);
    }
    // Only ever once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      disabled={pending || !hasSources}
      aria-busy={pending}
      onClick={() => run(false)}
      className="btn-ghost px-4 py-1.5 text-sm"
    >
      {pending ? "Checking, this can take a minute…" : "Check for new roles"}
    </button>
  );
}

export function SourceButtons({ gid, active, canCheck = false }: { gid: string; active: boolean; canCheck?: boolean }) {
  const [pending, start] = useTransition();
  const run = (action: () => Promise<{ error?: string }>) =>
    start(async () => {
      const result = await action();
      if (result.error) toast(result.error, { tone: "error" });
    });
  return canCheck ? (
    <button disabled={pending} aria-busy={pending} onClick={() => run(() => markSourceChecked(gid))} className="link">
      Checked today
    </button>
  ) : (
    <button
      disabled={pending}
      aria-busy={pending}
      onClick={() => run(() => setSourceActive(gid, !active))}
      className="hover:text-white hover:underline"
    >
      {active ? "Pause" : "Resume"}
    </button>
  );
}

export function AddSourceForm() {
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-1 gap-2 rounded-xl bg-white/5 p-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await addSource({ link, name });
          if (result.error) return toast(result.error, { tone: "error" });
          toast(
            result.kind === "link"
              ? `${name} added. Its careers page is read at the next check.`
              : `Following ${name}. Its roles arrive at the next check.`,
          );
          setLink("");
          setName("");
        });
      }}
    >
      <label className="text-sm">
        <span className="sr-only">Job link or careers page</span>
        <input
          required
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Job link or careers page"
          className={field}
        />
      </label>
      <label className="text-sm">
        <span className="sr-only">Employer</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Employer"
          className={field}
        />
      </label>
      <button disabled={pending} aria-busy={pending} className="btn-ghost px-4 py-1.5 text-sm">
        Follow
      </button>
    </form>
  );
}

/** What the toast says once a role is in, so the owner knows what read it. */
function addedMessage(result: Awaited<ReturnType<typeof addRoleFromAdvert>>): string {
  const what = `Added ${result.title ?? "the role"}.`;
  const by =
    result.readBy === "claude"
      ? " Claude read the advert: check its details."
      : result.readBy === "page"
        ? " Read from the page's own job details."
        : "";
  return `${what}${by}${result.note ? ` ${result.note}` : ""}`;
}

/** A role from a link or a pasted advert in one tap, or typed in by hand below it. */
export function AddRoleForm() {
  const empty = { title: "", company: "", location: "", url: "", salary: "", closesOn: "", text: "" };
  const [form, setForm] = useState(empty);
  const [source, setSource] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [pending, start] = useTransition();
  const router = useRouter();
  const titleField = useRef<HTMLInputElement>(null);
  const companyField = useRef<HTMLInputElement>(null);
  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  const openRole = (gid: string | undefined) => {
    startNavigation();
    router.push(`/jobs?view=applications&role=${gid}`, { scroll: false });
  };

  return (
    <div className="space-y-3">
      <form
        className="grid grid-cols-1 gap-2 rounded-xl bg-white/5 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setProblem(null);
          setHint(null);
          startReading(async () => {
            const result = await addRoleFromAdvert({ source });
            if (result.error) return setProblem(result.error);
            if (result.draft) {
              // Not enough to add it: what was read goes into the form, for the owner to finish.
              setForm(result.draft);
              setHint(`${result.note ? `${result.note} ` : ""}Add its title and employer below, then Add role.`);
              (result.draft.title ? companyField : titleField).current?.focus();
              return;
            }
            setSource("");
            toast(addedMessage(result));
            openRole(result.gid);
          });
        }}
      >
        <textarea
          required
          aria-label="Job link or advert"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={3}
          placeholder="Paste a job link, or the whole advert"
          className={field}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button disabled={reading} aria-busy={reading} className="btn-ghost px-4 py-1.5 text-sm">
            {reading ? "Reading the advert…" : "Add from the advert"}
          </button>
          <span className="text-xs text-muted">Saved at once. Fix any detail in the role.</span>
        </div>
        {problem && <ErrorNote message={problem} />}
        {hint && (
          <p role="status" className="text-sm text-sand">
            {hint}
          </p>
        )}
      </form>

      <form
        aria-label="Type in a role"
        className="grid grid-cols-1 gap-2 rounded-xl bg-white/5 p-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await addRoleByHand(form);
            if (result.error) return toast(result.error, { tone: "error" });
            setForm(empty);
            setHint(null);
            openRole(result.gid);
          });
        }}
      >
        <p className="text-xs text-muted sm:col-span-2">Or type it in.</p>
        <input
          ref={titleField}
          required
          aria-label="Role title"
          value={form.title}
          onChange={set("title")}
          placeholder="Role title"
          className={field}
        />
        <input
          ref={companyField}
          required
          aria-label="Employer"
          value={form.company}
          onChange={set("company")}
          placeholder="Employer"
          className={field}
        />
        <input
          aria-label="Location"
          value={form.location}
          onChange={set("location")}
          placeholder="Location"
          className={field}
        />
        <input
          aria-label="Link"
          type="url"
          value={form.url}
          onChange={set("url")}
          placeholder="Link"
          className={field}
        />
        <input
          aria-label="Salary"
          value={form.salary}
          onChange={set("salary")}
          placeholder="Salary, as the advert says"
          className={field}
        />
        <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-xs text-muted">
          Closes
          <input type="date" value={form.closesOn} onChange={set("closesOn")} className={field} />
        </label>
        <textarea
          aria-label="Advert text"
          value={form.text}
          onChange={set("text")}
          rows={6}
          placeholder="Paste the advert"
          className={`${field} sm:col-span-2`}
        />
        <div className="sm:col-span-2">
          <button disabled={pending} aria-busy={pending} className="btn-ghost px-4 py-1.5 text-sm">
            Add role
          </button>
        </div>
      </form>
    </div>
  );
}

export function EvidenceForm({
  skills,
  levels,
}: {
  skills: { key: string; name: string; group: string }[];
  levels: { level: number; name: string; meaning: string }[];
}) {
  const [skill, setSkill] = useState("");
  const [level, setLevel] = useState("4");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();
  const groups = [...new Set(skills.map((s) => s.group))];
  return (
    <form
      className="grid grid-cols-1 gap-2 rounded-xl bg-white/5 p-3 sm:grid-cols-2 lg:grid-cols-[14rem_11rem_minmax(0,1fr)_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await addEvidence({ skill, level: Number(level), note, url });
          if (result.error) return toast(result.error, { tone: "error" });
          setNote("");
          setUrl("");
        });
      }}
    >
      <select required aria-label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)} className={field}>
        <option value="" disabled>
          Skill
        </option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {skills
              .filter((s) => s.group === g)
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <select
        aria-label="Level"
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        className={field}
        title={levels.find((l) => String(l.level) === level)?.meaning}
      >
        {levels.map((l) => (
          <option key={l.level} value={l.level}>
            {l.name}
          </option>
        ))}
      </select>
      <input
        required
        aria-label="What the evidence is"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What it is, in a few words"
        className={field}
      />
      <input
        aria-label="Link"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link, if public"
        className={field}
      />
      <button disabled={pending} aria-busy={pending} className="btn-ghost px-4 py-1.5 text-sm">
        Add
      </button>
    </form>
  );
}

export function RemoveEvidenceButton({ gid }: { gid: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      aria-busy={pending}
      className="text-xs text-muted hover:text-white hover:underline"
      onClick={() =>
        start(async () => {
          const result = await removeEvidence(gid);
          if (result.error) toast(result.error, { tone: "error" });
        })
      }
    >
      Remove
    </button>
  );
}

export function CopySummary({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      <textarea
        readOnly
        value={text}
        rows={10}
        aria-label="Summary for your mentor"
        className={`${field} font-mono text-xs`}
      />
      <button
        className="btn-ghost px-4 py-1.5 text-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          toast("Copied.");
        }}
      >
        Copy
      </button>
    </div>
  );
}
