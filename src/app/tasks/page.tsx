import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { timeZone, usesAsana } from "@/lib/config/env";
import { listComments, listSections, taskDetails } from "@/lib/tasks/native";
import { allTasks, attempt, today, type TaskView } from "@/lib/portal/data";
import { isProjectKey, PROJECTS, projectDef, type ProjectKey } from "@/lib/config/projects";
import { formatHours } from "@/lib/tasks/session-log";
import { groupBySection, projectStats, type ProjectStats } from "@/lib/tasks/model";
import { ErrorNote, PageHeader } from "@/components/ui";
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

  const perProject = await Promise.all(
    PROJECTS.map(async (p) => ({ p, tasks: await attempt(() => allTasks(p.key)) })),
  );
  const current = perProject.find(({ p }) => p.key === key)!;
  const sections = await attempt(() => listSections(key));
  const tasks: TaskView[] = current.tasks.ok ? current.tasks.value : [];

  // The section of each task, which the shared task view leaves out.
  const sectionByName = new Map((sections.ok ? sections.value : []).map((s) => [s.name, s.gid]));
  const dashboardTasks: DashboardTask[] = tasks.map((t) => ({
    gid: t.gid,
    name: t.name,
    sectionGid: t.section ? (sectionByName.get(t.section) ?? null) : null,
    completed: t.completed,
    dueOn: t.dueOn,
    milestone: t.milestone,
    stage: t.stage ?? "Not started",
    hours: t.hours,
  }));
  const groups = groupBySection(sections.ok ? sections.value : [], dashboardTasks);

  const selected = params.task ? tasks.find((t) => t.gid === params.task) : undefined;
  const [details, comments] = selected
    ? await Promise.all([attempt(() => taskDetails(selected.gid)), attempt(() => listComments(selected.gid))])
    : [null, null];

  const hrefFor = (next: Partial<Search>) => {
    const q = new URLSearchParams({ project: key, ...(view === "board" ? { view } : {}), ...next });
    return `/tasks?${q}`;
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="All projects" title="Tasks">
        Every project at a glance. Open one to work through its sections, or use the board to move tasks between stages.
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {perProject.map(({ p, tasks: result }) => (
          <ProjectCard
            key={p.key}
            href={`/tasks?project=${p.key}${view === "board" ? "&view=board" : ""}`}
            title={p.title}
            area={p.area}
            active={p.key === key}
            stats={result.ok ? projectStats(result.value, date) : null}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{projectDef(key).title}</h2>
        <div className="flex gap-2" role="group" aria-label="View">
          <Link href={hrefFor({})} aria-current={view === "list" ? "true" : undefined} className={`px-4 py-1.5 ${view === "list" ? "btn-primary" : "btn-ghost"}`}>
            List
          </Link>
          <Link href={hrefFor({ view: "board" })} aria-current={view === "board" ? "true" : undefined} className={`px-4 py-1.5 ${view === "board" ? "btn-primary" : "btn-ghost"}`}>
            Board
          </Link>
        </div>
      </div>

      {!current.tasks.ok && <ErrorNote title="Could not load this project" message={current.tasks.error} />}
      {!sections.ok && <ErrorNote title="Could not load the sections" message={sections.error} />}

      {current.tasks.ok && sections.ok && (
        <TaskViews key={key} project={key} view={view} groups={groups} tasks={dashboardTasks} today={date} />
      )}

      {params.task && !selected && current.tasks.ok && <ErrorNote message="That task is not in this project any more." />}

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
            notes: details?.ok ? details.value.notes : "",
            sectionGid: details?.ok ? details.value.sectionGid : null,
          }}
          sections={sections.ok ? sections.value : []}
          comments={comments?.ok ? comments.value.map((c) => ({ gid: c.gid, text: c.text, createdAt: c.created_at })) : []}
          loadError={details && !details.ok ? details.error : comments && !comments.ok ? comments.error : null}
        />
      )}
    </div>
  );
}

function ProjectCard({ href, title, area, active, stats }: { href: string; title: string; area: string; active: boolean; stats: ProjectStats | null }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={`card-link space-y-3 ${active ? "ring-2 ring-lavender" : ""}`}>
      <div>
        <p className="eyebrow">{area}</p>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {!stats ? (
        <p className="text-sm text-neutral-400">Could not load.</p>
      ) : stats.total === 0 ? (
        <p className="text-sm text-neutral-400">No tasks yet.</p>
      ) : (
        <>
          <p className="text-3xl font-bold tabular-nums">
            {stats.percent}%<span className="ml-2 text-sm font-normal text-neutral-400">done</span>
          </p>
          <StageBar stats={stats} />
          <dl className="grid grid-cols-3 gap-2 text-xs text-neutral-400">
            <Stat label="Open" value={String(stats.open)} />
            <Stat label="Overdue" value={String(stats.overdue)} />
            <Stat label="Hours" value={formatHours(stats.hours)} />
          </dl>
        </>
      )}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="text-sm font-semibold text-white tabular-nums">{value}</dd>
    </div>
  );
}

/** Tasks per stage as one segmented bar, with a legend so colour is never the only cue. */
function StageBar({ stats }: { stats: ProjectStats }) {
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 gap-0.5" role="img" aria-label={stats.stages.map((s) => `${s.stage}: ${s.count}`).join(", ")}>
        {stats.stages.map((s) => (
          <span
            key={s.stage}
            title={`${s.stage}: ${s.count}`}
            className={`first:rounded-l last:rounded-r ${STAGE_MARKS[s.stage]}`}
            style={{ flexGrow: s.count, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-300">
        {stats.stages.map((s) => (
          <li key={s.stage} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STAGE_MARKS[s.stage]}`} aria-hidden />
            {s.stage} <span className="tabular-nums text-neutral-400">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
