"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { StartSessionButton } from "@/components/session-timer";
import { toast } from "@/components/toaster";
import { DueDate, Hours, StagePill, TaskLink } from "@/components/ui";
import { rescheduleTask, setTaskCompleted } from "./tasks/actions";

export type FocusTask = {
  gid: string;
  name: string;
  url: string;
  project: string;
  dueOn: string | null;
  stage: string | null;
  hours: number;
};

export type FocusGroup = { title: string; overdue?: boolean; tasks: FocusTask[] };

type Props = { today: string; tomorrow: string; canComplete: boolean };

export function FocusList({ groups, ...props }: Props & { groups: FocusGroup[] }) {
  return (
    <div className="space-y-6">
      {groups
        .filter((g) => g.tasks.length)
        .map((g) => (
          <div key={g.title}>
            <h3 className={`mb-1 text-sm font-semibold ${g.overdue ? "text-coral" : "text-body"}`}>
              {g.title} <span className="font-normal text-muted tabular-nums">{g.tasks.length}</span>
            </h3>
            <ul className="divide-y divide-white/5">
              {g.tasks.map((t) => (
                <FocusRow key={t.gid} task={t} overdue={Boolean(g.overdue)} {...props} />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function FocusRow({ task, overdue, today, tomorrow, canComplete }: Props & { task: FocusTask; overdue: boolean }) {
  const [pending, start] = useTransition();
  const [done, showDone] = useOptimistic(false);
  const undo = () =>
    start(async () => {
      await setTaskCompleted(task.gid, false);
    });

  const complete = () =>
    start(async () => {
      showDone(true);
      const result = await setTaskCompleted(task.gid, true);
      if (result.error) toast(result.error, { tone: "error" });
      else toast(`Finished ${task.name}.`, { action: { label: "Undo", onClick: undo } });
    });
  const moveTo = (date: string, label: string) =>
    start(async () => {
      const result = await rescheduleTask(task.gid, date);
      toast(result.error ?? `Moved to ${label}.`, result.error ? { tone: "error" } : {});
    });

  return (
    <li className={`group flex flex-wrap items-center gap-x-3 gap-y-2 py-3 ${done ? "opacity-50" : ""}`}>
      {canComplete && (
        <input
          type="checkbox"
          checked={done}
          disabled={pending}
          aria-busy={pending}
          onChange={complete}
          aria-label={`Mark ${task.name} done`}
          className="size-5 shrink-0 cursor-pointer accent-mint"
        />
      )}
      <div className="min-w-44 flex-1">
        <TaskLink href={task.url} className={`block text-sm font-medium hover:underline ${done ? "line-through" : ""}`}>
          {task.name}
        </TaskLink>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span>{task.project}</span>
          <DueDate dueOn={task.dueOn} today={today} />
          {overdue && (
            <>
              <button
                disabled={pending}
                aria-busy={pending}
                onClick={() => moveTo(today, "today")}
                className="min-h-6 cursor-pointer text-aqua hover:underline"
              >
                Today
              </button>
              <button
                disabled={pending}
                aria-busy={pending}
                onClick={() => moveTo(tomorrow, "tomorrow")}
                className="min-h-6 cursor-pointer text-aqua hover:underline"
              >
                Tomorrow
              </button>
            </>
          )}
          {task.hours > 0 && <Hours value={task.hours} />}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {task.stage && task.stage !== "Not started" && <StagePill stage={task.stage} />}
        <span className="flex items-center gap-1 transition md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <StartSessionButton gid={task.gid} name={task.name} className="btn-ghost px-3 py-1 text-xs" />
          <Link href={`/log?task=${task.gid}`} className="btn-ghost px-3 py-1 text-xs">
            Log
          </Link>
        </span>
      </div>
    </li>
  );
}
