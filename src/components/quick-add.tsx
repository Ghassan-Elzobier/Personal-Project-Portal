"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { createTask, createTasks } from "@/app/tasks/actions";
import { PROJECTS, projectDef, type ProjectKey } from "@/lib/config/projects";
import { shortDate } from "@/lib/dates/week";
import { parseQuickAdd, pastedLines } from "@/lib/tasks/quick-add";
import { toast } from "./toaster";

// Add a task from anywhere. Press n, or the Add button, and type a line such as
// "Read chapter 5 #axler fri". Paste several lines to add them all.

const LAST_PROJECT = "portal.lastProject";
const OPEN_EVENT = "portal:quick-add";

const GO_TO: Record<string, string> = { t: "/", u: "/study", a: "/tasks", s: "/schedule", l: "/log", w: "/week", m: "/timeline", p: "/progress" };

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.("input, textarea, select, [contenteditable=true]"));
}

export function openQuickAdd() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function QuickAddButton({ className }: { className: string }) {
  return (
    <button type="button" className={className} onClick={openQuickAdd} title="Add a task (n)">
      <span aria-hidden>+</span> Add task
    </button>
  );
}

export function QuickAdd({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let pendingGo = 0;
    const onOpen = () => setOpen(true);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
      if (pendingGo && Date.now() - pendingGo < 1200) {
        pendingGo = 0;
        const href = GO_TO[e.key];
        if (href) router.push(href);
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "g") {
        pendingGo = Date.now();
      } else if (e.key === "?") {
        setHelp((h) => !h);
      } else if (e.key === "Escape") {
        setHelp(false);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  // On a project's Tasks page, new tasks default to that project.
  const here = pathname === "/tasks" && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("project") : null;

  return (
    <>
      {open && <QuickAddDialog today={today} projectHere={here} onClose={() => setOpen(false)} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function QuickAddDialog({ today, projectHere, onClose }: { today: string; projectHere: string | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [project, setProject] = useState<ProjectKey>(() => {
    const saved = projectHere ?? window.localStorage.getItem(LAST_PROJECT);
    return PROJECTS.find((p) => p.key === saved)?.key ?? PROJECTS[0].key;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => input.current?.focus(), []);

  const lines = pastedLines(text);
  const many = lines.length > 1;
  const parsed = parseQuickAdd(text, today);
  const target = (!many && parsed.project) || project;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!lines.length) return;
    start(async () => {
      window.localStorage.setItem(LAST_PROJECT, target);
      const result = many
        ? await createTasks({ project: target, names: lines })
        : await createTask({ project: target, name: parsed.name, dueOn: parsed.dueOn });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(many ? `Added ${lines.length} tasks to ${projectDef(target).title}.` : `Added to ${projectDef(target).title}.`);
      onClose();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-primary/70 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add a task"
        onSubmit={submit}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="w-full max-w-xl space-y-3 rounded-2xl bg-navy p-5 shadow-2xl ring-1 ring-white/15"
      >
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={many ? Math.min(lines.length + 1, 8) : 1}
          maxLength={20000}
          aria-label="New task"
          placeholder="Read chapter 5 #axler fri"
          className="w-full resize-none bg-transparent text-lg placeholder-neutral-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="sr-only" htmlFor="quick-project">Project</label>
            <select
              id="quick-project"
              value={target}
              onChange={(e) => setProject(e.target.value as ProjectKey)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm"
            >
              {PROJECTS.map((p) => (
                <option key={p.key} value={p.key}>{p.title}</option>
              ))}
            </select>
            {many ? (
              <span className="chip bg-white/5 text-neutral-300 ring-white/10">{lines.length} tasks, one per line</span>
            ) : (
              parsed.dueOn && <span className="chip bg-aqua/10 text-aqua ring-aqua/30">Due {shortDate(parsed.dueOn)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-ghost px-4 py-1.5">Cancel</button>
            <button disabled={pending || !lines.length} className="btn-primary px-4 py-1.5">
              {pending ? "Adding…" : many ? `Add ${lines.length}` : "Add"}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-coral" role="alert">{error}</p>}
        <p className="text-xs text-neutral-400">
          Tag a project with #axler, #pmpp, #rendering or #weekly. End with a date: today, tomorrow, fri, 20 nov. Paste a list to add every line.
        </p>
      </form>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["n", "Add a task"],
  ["/", "Search tasks, on the Tasks page"],
  ["g then t", "Today"],
  ["g then u", "Study"],
  ["g then a", "Tasks"],
  ["g then s", "Schedule"],
  ["g then l", "Log a session"],
  ["g then w", "Sunday update"],
  ["g then m", "Timeline"],
  ["g then p", "Progress"],
  ["?", "This list"],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-primary/70 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-full max-w-sm rounded-2xl bg-navy p-5 shadow-2xl ring-1 ring-white/15">
        <h2 className="mb-3 font-semibold">Keyboard shortcuts</h2>
        <dl className="space-y-2 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-4">
              <dt className="text-neutral-300">{what}</dt>
              <dd><kbd className="rounded bg-white/10 px-2 py-0.5 text-xs">{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
