"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition, type DragEvent } from "react";
import { DueDate, Hours, StagePill } from "@/components/ui";
import { STAGES } from "@/lib/tasks/session-log";
import { addSection, createTask, removeSection, setTaskCompleted, setTaskStage, type ActionResult } from "./actions";

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

/** Runs a server action and shows its error. The action refreshes the page's data. */
function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ActionResult>, then?: () => void) =>
    start(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) then?.();
    });
  return { pending, error, run };
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
}: {
  project: string;
  view: "list" | "board";
  groups: Group[];
  tasks: DashboardTask[];
  today: string;
}) {
  return view === "board" ? (
    <Board project={project} section={groups.find((g) => g.gid)?.gid ?? undefined} tasks={tasks} today={today} />
  ) : (
    <List project={project} groups={groups} today={today} />
  );
}

function List({ project, groups, today }: { project: string; groups: Group[]; today: string }) {
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <SectionBlock key={g.gid ?? "none"} project={project} group={g} today={today} />
      ))}
      <AddSection project={project} />
    </div>
  );
}

function SectionBlock({ project, group, today }: { project: string; group: Group; today: string }) {
  const { pending, error, run } = useRun();
  const remove = () => {
    if (window.confirm(`Delete the section "${group.name}"? Its tasks stay, with no section.`)) {
      run(() => removeSection(group.gid!));
    }
  };
  return (
    <section aria-label={group.name}>
      <div className="mb-2 flex items-baseline justify-between gap-4 border-b border-white/10 pb-2">
        <h3 className="font-semibold">
          {group.name} <span className="ml-1 text-sm font-normal text-neutral-500 tabular-nums">{group.tasks.length}</span>
        </h3>
        {group.gid && (
          <button onClick={remove} disabled={pending} className="cursor-pointer text-xs text-neutral-500 hover:text-white disabled:opacity-50">
            Delete section
          </button>
        )}
      </div>
      {error && <p className="mb-2 text-sm text-coral" role="alert">{error}</p>}
      <ul className="divide-y divide-white/5">
        {group.tasks.map((t) => (
          <TaskRow key={t.gid} task={t} today={today} />
        ))}
      </ul>
      {group.gid && <AddTask project={project} section={group.gid} />}
    </section>
  );
}

function TaskRow({ task, today }: { task: DashboardTask; today: string }) {
  const { pending, error, run } = useRun();
  const href = useTaskHref();
  // Shown at once and corrected by the server's answer, so controls never snap back.
  const [completed, showCompleted] = useOptimistic(task.completed);
  const [stage, showStage] = useOptimistic(task.stage);
  const complete = (done: boolean) =>
    run(() => {
      showCompleted(done);
      return setTaskCompleted(task.gid, done);
    });
  const changeStage = (next: string) =>
    run(() => {
      showStage(next);
      return setTaskStage(task.gid, next);
    });
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CompleteBox name={task.name} checked={completed} disabled={pending} onChange={complete} />
        <Link href={href(task.gid)} scroll={false} className={`min-w-40 flex-1 text-sm hover:underline ${completed ? "text-neutral-500 line-through" : ""}`}>
          {task.milestone && <span className="mr-1 text-lavender" title="Milestone">◆</span>}
          {task.name}
        </Link>
        <span className="text-xs"><DueDate dueOn={task.completed ? null : task.dueOn} today={today} /></span>
        {task.hours > 0 && <span className="text-xs text-neutral-400"><Hours value={task.hours} /></span>}
        <label className="sr-only" htmlFor={`stage-${task.gid}`}>Stage of {task.name}</label>
        <select
          id={`stage-${task.gid}`}
          value={stage}
          disabled={pending}
          onChange={(e) => changeStage(e.target.value)}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs"
        >
          {STAGES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="mt-1 text-sm text-coral" role="alert">{error}</p>}
    </li>
  );
}

function CompleteBox({ name, checked, disabled, onChange }: { name: string; checked: boolean; disabled: boolean; onChange: (done: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={`Mark ${name} ${checked ? "not done" : "done"}`}
      className="h-4 w-4 cursor-pointer accent-mint"
    />
  );
}

function AddTask({ project, section, placeholder = "Add a task to this section" }: { project: string; section?: string; placeholder?: string }) {
  const { pending, error, run } = useRun();
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [milestone, setMilestone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = (e: React.FormEvent) => {
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
  return (
    <form onSubmit={submit} className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          aria-label="New task name"
          maxLength={500}
          className="min-h-9 min-w-48 flex-1 rounded-md border border-white/10 bg-white/5 px-3 text-sm placeholder-neutral-500"
        />
        <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Due date" className="min-h-9 rounded-md border border-white/10 bg-white/5 px-2 text-sm" />
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} className="accent-lavender" />
          Milestone
        </label>
        <button disabled={pending || !name.trim()} className="btn-ghost px-4 py-1.5">Add</button>
      </div>
      {error && <p className="mt-1 text-sm text-coral" role="alert">{error}</p>}
    </form>
  );
}

function AddSection({ project }: { project: string }) {
  const { pending, error, run } = useRun();
  const [name, setName] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => addSection(project, name), () => setName(""));
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New section"
        aria-label="New section name"
        maxLength={120}
        className="min-h-9 rounded-md border border-white/10 bg-white/5 px-3 text-sm placeholder-neutral-500"
      />
      <button disabled={pending || !name.trim()} className="btn-ghost px-4 py-1.5">Add section</button>
      {error && <p className="text-sm text-coral" role="alert">{error}</p>}
    </form>
  );
}

function Board({ project, section, tasks, today }: { project: string; section?: string; tasks: DashboardTask[]; today: string }) {
  const { pending, error, run } = useRun();
  const [over, setOver] = useState<string | null>(null);
  const router = useRouter();
  const href = useTaskHref();

  const drop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    setOver(null);
    const gid = e.dataTransfer.getData("text/plain");
    const task = tasks.find((t) => t.gid === gid);
    if (task && task.stage !== stage) run(() => setTaskStage(gid, stage), () => router.refresh());
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-coral" role="alert">{error}</p>}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
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
              className={`min-h-40 space-y-2 rounded-2xl bg-white/5 p-3 ring-1 transition ${over === stage ? "ring-lavender" : "ring-white/5"} ${pending ? "opacity-70" : ""}`}
            >
              <header className="flex items-center justify-between">
                <StagePill stage={stage} />
                <span className="text-xs text-neutral-500 tabular-nums">{column.length}</span>
              </header>
              {column.map((t) => (
                <article
                  key={t.gid}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", t.gid)}
                  className="card cursor-grab space-y-2 p-3 active:cursor-grabbing"
                >
                  <Link href={href(t.gid)} scroll={false} className={`block text-sm hover:underline ${t.completed ? "text-neutral-500 line-through" : ""}`}>
                    {t.milestone && <span className="mr-1 text-lavender" title="Milestone">◆</span>}
                    {t.name}
                  </Link>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <DueDate dueOn={t.completed ? null : t.dueOn} today={today} />
                    {t.hours > 0 && <span className="text-neutral-400"><Hours value={t.hours} /></span>}
                  </div>
                  <label className="sr-only" htmlFor={`board-stage-${t.gid}`}>Stage of {t.name}</label>
                  <select
                    id={`board-stage-${t.gid}`}
                    value={t.stage}
                    disabled={pending}
                    onChange={(e) => run(() => setTaskStage(t.gid, e.target.value))}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs"
                  >
                    {STAGES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <AddTask project={project} section={section} placeholder="Add a task" />
    </div>
  );
}
