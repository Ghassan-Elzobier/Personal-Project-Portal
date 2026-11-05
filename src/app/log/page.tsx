import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { getTask, projectKeyOfTask } from "@/lib/tasks/tracker";
import { projectGid } from "@/lib/config/env";
import { attempt, openTasks, toView, type TaskView } from "@/lib/portal/data";
import { PROJECTS } from "@/lib/config/projects";
import { STAGES } from "@/lib/tasks/session-log";
import { ErrorNote, PageHeader } from "@/components/ui";
import { LogForm, type TaskOption } from "./log-form";

export const metadata: Metadata = { title: "Log a session" };
export const dynamic = "force-dynamic";

export default async function LogPage({ searchParams }: { searchParams: Promise<{ task?: string; hours?: string }> }) {
  await requireOwner();
  const { task: preselect, hours } = await searchParams;
  // Sent by the session timer. Anything else starts from the usual default.
  const startHours = hours && Number(hours) >= 0.25 && Number(hours) <= 16 ? String(Number(hours)) : null;

  const configured = PROJECTS.filter((p) => projectGid(p.key));
  const results = await Promise.all(configured.map(async (p) => ({ p, tasks: await attempt(() => openTasks(p.key)) })));

  const tasks: TaskView[] = results.flatMap((r) => (r.tasks.ok ? r.tasks.value : []));
  const errors = results.filter((r) => !r.tasks.ok).map((r) => `${r.p.title}: ${(r.tasks as { error: string }).error}`);

  // A finished task linked from "Needs attention" (to add evidence) is not
  // in the open list, so fetch it on its own.
  if (preselect && /^\d+$/.test(preselect) && !tasks.some((t) => t.gid === preselect)) {
    const extra = await attempt(async () => {
      const task = await getTask(preselect);
      const key = await projectKeyOfTask(task);
      return key ? toView(task, key) : null;
    });
    if (extra.ok && extra.value) tasks.unshift(extra.value);
  }

  const options: TaskOption[] = tasks.map((t) => ({
    gid: t.gid,
    name: t.name,
    project: PROJECTS.find((p) => p.key === t.project)!.title,
    stage: t.stage,
    hours: t.hours,
    evidence: t.evidence,
    completed: t.completed,
    dueOn: t.dueOn,
    stageOptions: t.stageOptions.length ? t.stageOptions : [...STAGES],
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Daily" title="Log a session">
        Adds the hours to the task&apos;s Hours field, sets Stage and Evidence, and leaves a comment that the Sunday
        update reads.
      </PageHeader>
      {errors.length > 0 && (
        <div className="mb-6 space-y-2">
          {errors.map((e) => (
            <ErrorNote key={e} message={e} />
          ))}
        </div>
      )}
      <LogForm tasks={options} preselect={preselect ?? null} startHours={startHours} />
    </div>
  );
}
