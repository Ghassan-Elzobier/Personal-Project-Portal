import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { timeZone, usesAsana } from "@/lib/config/env";
import { isProjectKey, PROJECTS, projectDef, type ProjectKey } from "@/lib/config/projects";
import { addDays } from "@/lib/dates/week";
import { allTasks, attempt, today, type TaskView } from "@/lib/portal/data";
import { groupBySection, projectStats, type ProjectStats } from "@/lib/tasks/model";
import { panelFor } from "@/lib/study/load";
import { listComments, listSections, studySnapshot } from "@/lib/tasks/native";
import { formatHours } from "@/lib/tasks/session-log";
import { ErrorNote, PageHeader } from "@/components/ui";
import { StudyPanel } from "../study/study-panel";
import { TaskPane } from "./task-pane";
import { TaskViews, type DashboardTask } from "./task-views";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

type Search = { project?: string; view?: string; task?: string };

// Stage colours are status marks, always beside a text label in the legend.
// Each neighbouring pair stays distinct under colour blindness on the card surface.
const STAGE_MARKS: Record<string, string> = {
  "Not started": "bg-neutral-500",
  "In progress": "bg-aqua",
  Blocked: "bg-coral",
  "Needs review": "bg-sand",
  Done: "bg-mint",
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireOwner();
  if (usesAsana()) notFound();

  const params = await searchParams;
  const key: ProjectKey = params.project && isProjectKey(params.project) ? params.project : PROJECTS[0].key;
  const view = params.view === "board" ? "board" : "list";
  const date = today();

  const perProject = await Promise.all(PROJECTS.map(async (p) => ({ p, tasks: await attempt(() => allTasks(p.key)) })));
  const current = perProject.find(({ p }) => p.key === key)!;
  const sections = await attempt(() => listSections(key));
  const tasks: TaskView[] = current.tasks.ok ? current.tasks.value : [];
  const stats = projectStats(tasks, date);

  const dashboardTasks: DashboardTask[] = tasks.map((t) => ({
    gid: t.gid,
    name: t.name,
    sectionGid: t.sectionGid,
    completed: t.completed,
    dueOn: t.dueOn,
    milestone: t.milestone,
    stage: t.stage ?? "Not started",
    hours: t.hours,
  }));
  const groups = groupBySection(sections.ok ? sections.value : [], dashboardTasks);

  const selected = params.task ? tasks.find((t) => t.gid === params.task) : undefined;
  const comments = selected ? await attempt(() => listComments(selected.gid)) : null;
  const study = selected ? await attempt(() => studySnapshot()) : null;

  const hrefFor = (next: Partial<Search>) => {
    const q = new URLSearchParams({ project: key, ...(view === "board" ? { view } : {}), ...next });
    return `/tasks?${q}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" />

      <nav aria-label="Projects" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {perProject.map(({ p, tasks: result }) => (
          <ProjectTab
            key={p.key}
            href={`/tasks?project=${p.key}${view === "board" ? "&view=board" : ""}`}
            title={p.title}
            active={p.key === key}
            stats={result.ok ? projectStats(result.value, date) : null}
          />
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{projectDef(key).title}</h2>
        <div className="flex gap-2" role="group" aria-label="View">
          <Link
            href={hrefFor({})}
            aria-current={view === "list" ? "true" : undefined}
            className={`px-4 py-1.5 ${view === "list" ? "btn-primary" : "btn-ghost"}`}
          >
            List
          </Link>
          <Link
            href={hrefFor({ view: "board" })}
            aria-current={view === "board" ? "true" : undefined}
            className={`px-4 py-1.5 ${view === "board" ? "btn-primary" : "btn-ghost"}`}
          >
            Board
          </Link>
        </div>
      </div>

      {stats.total > 0 && <StageBar stats={stats} />}

      {!current.tasks.ok && <ErrorNote title="Could not load this project" message={current.tasks.error} />}
      {!sections.ok && <ErrorNote title="Could not load the sections" message={sections.error} />}

      {current.tasks.ok && sections.ok && (
        <TaskViews
          key={key}
          project={key}
          view={view}
          groups={groups}
          tasks={dashboardTasks}
          today={date}
          tomorrow={addDays(date, 1)}
        />
      )}

      {params.task && !selected && current.tasks.ok && (
        <ErrorNote message="That task is not in this project any more." />
      )}

      {selected && (
        <TaskPane
          key={selected.gid}
          closeHref={hrefFor({})}
          timeZone={timeZone()}
          task={{
            gid: selected.gid,
            name: selected.name,
            completed: selected.completed,
            dueOn: selected.dueOn,
            stage: selected.stage ?? "Not started",
            hours: selected.hours,
            evidence: selected.evidence,
            milestone: selected.milestone,
            notes: selected.notes,
            sectionGid: selected.sectionGid,
          }}
          sections={sections.ok ? sections.value : []}
          comments={
            comments?.ok ? comments.value.map((c) => ({ gid: c.gid, text: c.text, createdAt: c.created_at })) : []
          }
          loadError={comments && !comments.ok ? comments.error : null}
        >
          {study?.ok && <StudyPanel data={panelFor({ task: selected }, study.value)} />}
        </TaskPane>
      )}
    </div>
  );
}

function ProjectTab({
  href,
  title,
  active,
  stats,
}: {
  href: string;
  title: string;
  active: boolean;
  stats: ProjectStats | null;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-xl p-3 ring-1 transition hover:ring-white/25 ${active ? "bg-lavender/15 ring-lavender" : "bg-white/5 ring-white/5"}`}
    >
      <span className="block text-sm font-semibold">{title}</span>
      {!stats ? (
        <span className="text-xs text-neutral-400">Could not load</span>
      ) : stats.total === 0 ? (
        <span className="text-xs text-neutral-400">No tasks yet</span>
      ) : (
        <>
          <span className="block text-xs text-neutral-300 tabular-nums">
            {stats.open} open{stats.overdue > 0 && `, ${stats.overdue} overdue`} · {formatHours(stats.hours)} h
          </span>
          <span
            className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"
            role="img"
            aria-label={`${stats.percent}% done`}
          >
            <span className="block h-full rounded-full bg-mint" style={{ width: `${stats.percent}%` }} />
          </span>
        </>
      )}
    </Link>
  );
}

/** Tasks per stage as one segmented bar, with a legend so colour is never the only cue. */
function StageBar({ stats }: { stats: ProjectStats }) {
  return (
    <div className="space-y-2">
      <div
        className="flex h-2.5 gap-0.5"
        role="img"
        aria-label={stats.stages.map((s) => `${s.stage}: ${s.count}`).join(", ")}
      >
        {stats.stages.map((s) => (
          <span
            key={s.stage}
            title={`${s.stage}: ${s.count}`}
            className={`first:rounded-l last:rounded-r ${STAGE_MARKS[s.stage]}`}
            style={{ flexGrow: s.count, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
        {stats.stages.map((s) => (
          <li key={s.stage} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STAGE_MARKS[s.stage]}`} aria-hidden />
            {s.stage} <span className="text-neutral-400 tabular-nums">{s.count}</span>
          </li>
        ))}
        <li className="text-neutral-400">{stats.percent}% done</li>
      </ul>
    </div>
  );
}
