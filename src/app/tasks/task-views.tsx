"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { StartSessionButton } from "@/components/session-timer";
import { toast } from "@/components/toaster";
import { DueDate, Hours, StagePill } from "@/components/ui";
import { pastedLines } from "@/lib/tasks/quick-add";
import { STAGES } from "@/lib/tasks/session-log";
import {
  addSection,
  createTask,
  createTasks,
  editTask,
  removeSection,
  rescheduleTask,
  setTaskCompleted,
  setTaskStage,
  type ActionResult,
} from "./actions";

export type DashboardTask = {
  gid: string;
  name: string;
  sectionGid: string | null;
  completed: boolean;
  dueOn: string | null;
  milestone: boolean;
  stage: string;
  hours: number;
};

type Group = { gid: string | null; name: string; tasks: DashboardTask[] };

type Filter = "all" | "overdue" | "soon" | "blocked" | "undated";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Next 7 days" },
  { key: "blocked", label: "Blocked" },
  { key: "undated", label: "No date" },
];

const dayAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function matches(t: DashboardTask, filter: Filter, search: string, today: string): boolean {
  if (search && !t.name.toLowerCase().includes(search)) return false;
  if (filter === "all") return true;
  if (t.completed) return false;
  if (filter === "overdue") return t.dueOn !== null && t.dueOn < today;
  if (filter === "soon") return t.dueOn !== null && t.dueOn >= today && t.dueOn <= dayAfter(today, 7);
  if (filter === "blocked") return t.stage === "Blocked";
  return t.dueOn === null;
}

/** Runs a server action and reports any error. The action refreshes the page's data. */
function useRun() {
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ActionResult>, then?: () => void) =>
    start(async () => {
      const result = await action();
      if (result.error) toast(result.error, { tone: "error" });
      else then?.();
    });
  return { pending, run };
}

function useTaskHref() {
  const params = useSearchParams();
  return (gid: string) => {
    const q = new URLSearchParams(params);
    q.set("task", gid);
    return `/tasks?${q}`;
  };
}

export function TaskViews({
  project,
  view,
  groups,
  tasks,
  today,
  tomorrow,
}: {
  project: string;
  view: "list" | "board";
  groups: Group[];
  tasks: DashboardTask[];
  today: string;
  tomorrow: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  const search = query.trim().toLowerCase();
  const firstSection = groups.find((g) => g.gid)?.gid ?? undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !el.closest("input, textarea, select")) {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => tasks.filter((t) => matches(t, filter, search, today)), [tasks, filter, search, today]);
  const narrowed = filter !== "all" || search !== "";

  if (tasks.length === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-2 card-special">
          <h3 className="text-lg font-semibold">Nothing here yet</h3>
          <p className="text-sm text-white/90">
            Type a task below, or paste a list of chapters and each line becomes a task.
          </p>
        </div>
        <List project={project} groups={groups} shownIds={null} today={today} tomorrow={tomorrow} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchBox}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="min-h-9 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm placeholder-neutral-400 sm:w-56"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`btn min-h-9 px-3 py-1 text-xs ring-1 ${filter === f.key ? "bg-white/15 text-white ring-white/30" : "bg-transparent text-neutral-300 ring-white/10 hover:bg-white/5"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {narrowed && shown.length === 0 && (
        <p className="rounded-xl bg-white/5 p-4 text-sm text-neutral-400">No tasks match. Try another filter.</p>
      )}

      {view === "board" ? (
        <Board project={project} section={firstSection} tasks={shown} today={today} />
      ) : (
        <List
          project={project}
          groups={groups}
          shownIds={narrowed ? new Set(shown.map((t) => t.gid)) : null}
          today={today}
          tomorrow={tomorrow}
        />
      )}
    </div>
  );
}

function List({
  project,
  groups,
  shownIds,
  today,
  tomorrow,
}: {
  project: string;
  groups: Group[];
  shownIds: Set<string> | null;
  today: string;
  tomorrow: string;
}) {
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <SectionBlock
          key={g.gid ?? "none"}
          project={project}
          group={shownIds ? { ...g, tasks: g.tasks.filter((t) => shownIds.has(t.gid)) } : g}
          narrowed={shownIds !== null}
          today={today}
          tomorrow={tomorrow}
        />
      ))}
      {!shownIds && <AddSection project={project} />}
    </div>
  );
}

function SectionBlock({
  project,
  group,
  narrowed,
  today,
  tomorrow,
}: {
  project: string;
  group: Group;
  narrowed: boolean;
  today: string;
  tomorrow: string;
}) {
  const { pending, run } = useRun();
  const [over, setOver] = useState(false);
  const open = group.tasks.filter((t) => !t.completed);
  const done = group.tasks.filter((t) => t.completed);

  if (narrowed && group.tasks.length === 0) return null;

  const remove = () => {
    if (window.confirm(`Delete the section "${group.name}"? Its tasks stay, with no section.`)) {
      run(() => removeSection(group.gid!));
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const gid = e.dataTransfer.getData("text/plain");
    if (gid) run(() => editTask(gid, { section: group.gid ?? "" }));
  };

  return (
    <section
      aria-label={group.name}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={drop}
      className={`rounded-xl transition ${over ? "ring-2 ring-lavender/60" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-2">
        <h3 className="font-semibold">
          {group.name} <span className="ml-1 text-sm font-normal text-neutral-400 tabular-nums">{open.length}</span>
        </h3>
        {group.gid && !narrowed && (
          <button
            onClick={remove}
            disabled={pending}
            aria-busy={pending}
            className="cursor-pointer text-xs text-neutral-400 hover:text-white disabled:opacity-50"
          >
            Delete section
          </button>
        )}
      </div>
      <ul className="divide-y divide-white/5">
        {open.map((t) => (
          <TaskRow key={t.gid} task={t} today={today} tomorrow={tomorrow} />
        ))}
      </ul>
      {group.gid && !narrowed && <AddTask project={project} section={group.gid} />}
      {done.length > 0 && (
        <details className="mt-2" open={narrowed}>
          <summary className="cursor-pointer py-1 text-xs text-neutral-400 hover:text-white">
            {done.length} completed
          </summary>
          <ul className="divide-y divide-white/5">
            {done.map((t) => (
              <TaskRow key={t.gid} task={t} today={today} tomorrow={tomorrow} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TaskRow({ task, today, tomorrow }: { task: DashboardTask; today: string; tomorrow: string }) {
  const { pending, run } = useRun();
  const href = useTaskHref();
  // Shown at once and corrected by the server's answer, so controls never snap back.
  const [completed, showCompleted] = useOptimistic(task.completed);
  const [stage, showStage] = useOptimistic(task.stage);
  const overdue = !completed && task.dueOn !== null && task.dueOn < today;

  const complete = (done: boolean) =>
    run(
      () => {
        showCompleted(done);
        return setTaskCompleted(task.gid, done);
      },
      () => {
        if (done)
          toast(`Finished ${task.name}.`, {
            action: { label: "Undo", onClick: () => run(() => setTaskCompleted(task.gid, false)) },
          });
      },
    );
  const changeStage = (next: string) =>
    run(() => {
      showStage(next);
      return setTaskStage(task.gid, next);
    });

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.gid);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <input
          type="checkbox"
          checked={completed}
          disabled={pending}
          aria-busy={pending}
          onChange={(e) => complete(e.target.checked)}
          aria-label={`Mark ${task.name} ${completed ? "not done" : "done"}`}
          className="size-5 shrink-0 cursor-pointer accent-mint"
        />
        <Link
          href={href(task.gid)}
          scroll={false}
          className={`min-w-40 flex-1 text-sm hover:underline ${completed ? "text-neutral-400 line-through" : ""}`}
        >
          {task.milestone && (
            <span className="mr-1 text-lavender" title="Milestone">
              ◆
            </span>
          )}
          {task.name}
        </Link>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <DueDate dueOn={completed ? null : task.dueOn} today={today} />
          {overdue && (
            <>
              <button
                disabled={pending}
                aria-busy={pending}
                onClick={() => run(() => rescheduleTask(task.gid, today))}
                className="cursor-pointer text-aqua hover:underline"
              >
                Today
              </button>
              <button
                disabled={pending}
                aria-busy={pending}
                onClick={() => run(() => rescheduleTask(task.gid, tomorrow))}
                className="cursor-pointer text-aqua hover:underline"
              >
                Tomorrow
              </button>
            </>
          )}
          {task.hours > 0 && (
            <span className="text-neutral-400">
              <Hours value={task.hours} />
            </span>
          )}
        </span>
        {!completed && (
          <span className="flex items-center gap-1 transition md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <StartSessionButton gid={task.gid} name={task.name} className="btn-ghost px-2.5 py-0.5 text-xs" />
            <Link href={`/log?task=${task.gid}`} className="btn-ghost px-2.5 py-0.5 text-xs">
              Log
            </Link>
          </span>
        )}
        <label className="sr-only" htmlFor={`stage-${task.gid}`}>
          Stage of {task.name}
        </label>
        <select
          id={`stage-${task.gid}`}
          value={stage}
          disabled={pending}
          aria-busy={pending}
          onChange={(e) => changeStage(e.target.value)}
          className="w-28 rounded-md border border-transparent bg-transparent p-1 text-xs text-neutral-300 hover:border-white/10 focus:border-white/20"
        >
          {STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
    </li>
  );
}

function AddTask({
  project,
  section,
  placeholder = "Add a task",
}: {
  project: string;
  section?: string;
  placeholder?: string;
}) {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [milestone, setMilestone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Keep anything typed before the page finished loading.
  useEffect(() => {
    if (input.current?.value) setName(input.current.value);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(
      () => createTask({ project, name, section: section ?? null, dueOn: dueOn || null, milestone }),
      () => {
        setName("");
        setDueOn("");
        setMilestone(false);
        input.current?.focus();
      },
    );
  };
  // A pasted list becomes one task per line.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const lines = pastedLines(e.clipboardData.getData("text"));
    if (lines.length < 2) return;
    e.preventDefault();
    run(
      () => createTasks({ project, names: lines, section: section ?? null }),
      () => toast(`Added ${lines.length} tasks.`),
    );
  };

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        ref={input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPaste={onPaste}
        placeholder={placeholder}
        aria-label="New task name"
        maxLength={500}
        className="min-h-9 min-w-48 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm placeholder-neutral-400 hover:border-white/10 focus:border-white/20 focus:bg-white/5"
      />
      {name.trim() && (
        <>
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            aria-label="Due date"
            className="min-h-9 rounded-md border border-white/10 bg-white/5 px-2 text-sm"
          />
          <label className="flex items-center gap-1.5 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={milestone}
              onChange={(e) => setMilestone(e.target.checked)}
              className="accent-lavender"
            />
            Milestone
          </label>
          <button disabled={pending} aria-busy={pending} className="btn-ghost px-4 py-1.5">
            Add
          </button>
        </>
      )}
    </form>
  );
}

function AddSection({ project }: { project: string }) {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(
      () => addSection(project, name),
      () => setName(""),
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New section"
        aria-label="New section name"
        maxLength={120}
        className="min-h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm placeholder-neutral-400"
      />
      <button disabled={pending || !name.trim()} aria-busy={pending} className="btn-ghost px-4 py-1.5">
        Add section
      </button>
    </form>
  );
}

function Board({
  project,
  section,
  tasks,
  today,
}: {
  project: string;
  section?: string;
  tasks: DashboardTask[];
  today: string;
}) {
  const { pending, run } = useRun();
  const [over, setOver] = useState<string | null>(null);
  const href = useTaskHref();

  const drop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    setOver(null);
    const gid = e.dataTransfer.getData("text/plain");
    const task = tasks.find((t) => t.gid === gid);
    if (task && task.stage !== stage) run(() => setTaskStage(gid, stage));
  };

  return (
    <div className="space-y-3">
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 md:grid md:grid-cols-3 md:overflow-visible xl:grid-cols-5">
        {STAGES.map((stage) => {
          const column = tasks.filter((t) => t.stage === stage);
          return (
            <section
              key={stage}
              aria-label={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => drop(e, stage)}
              className={`min-h-40 w-64 shrink-0 snap-start space-y-2 rounded-2xl bg-white/5 p-3 ring-1 transition md:w-auto ${over === stage ? "ring-lavender" : "ring-white/5"} ${pending ? "opacity-70" : ""}`}
            >
              <header className="flex items-center justify-between">
                <StagePill stage={stage} />
                <span className="text-xs text-neutral-400 tabular-nums">{column.length}</span>
              </header>
              {column.map((t) => (
                <article
                  key={t.gid}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", t.gid)}
                  className="cursor-grab space-y-2 rounded-xl bg-indigo p-3 ring-1 ring-white/5 hover:ring-white/20 active:cursor-grabbing"
                >
                  <Link
                    href={href(t.gid)}
                    scroll={false}
                    className={`block text-sm hover:underline ${t.completed ? "text-neutral-400 line-through" : ""}`}
                  >
                    {t.milestone && (
                      <span className="mr-1 text-lavender" title="Milestone">
                        ◆
                      </span>
                    )}
                    {t.name}
                  </Link>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <DueDate dueOn={t.completed ? null : t.dueOn} today={today} />
                    {t.hours > 0 && (
                      <span className="text-neutral-400">
                        <Hours value={t.hours} />
                      </span>
                    )}
                  </div>
                  <label className="sr-only" htmlFor={`board-stage-${t.gid}`}>
                    Stage of {t.name}
                  </label>
                  <select
                    id={`board-stage-${t.gid}`}
                    value={t.stage}
                    disabled={pending}
                    aria-busy={pending}
                    onChange={(e) => run(() => setTaskStage(t.gid, e.target.value))}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs"
                  >
                    {STAGES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <AddTask project={project} section={section} />
    </div>
  );
}
