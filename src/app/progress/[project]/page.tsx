import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canRead, requireAccess } from "@/lib/auth/access";
import { listSessionComments, verifiedProject } from "@/lib/tasks/tracker";
import { addDays, midnightIn, shortDate, weekOf } from "@/lib/dates/week";
import { hoursByWeek, type WeekHours } from "@/lib/portal/stats";
import { projectGid, timeZone, usesAsana } from "@/lib/config/env";
import { loadStudy } from "@/lib/study/load";
import { planFor } from "@/lib/study/plans";
import { BenchmarkTable } from "../../study/benchmarks";
import { allTasks, attempt, latestStatus, today, type TaskView } from "@/lib/portal/data";
import { isProjectKey, projectDef } from "@/lib/config/projects";
import { formatHours } from "@/lib/tasks/session-log";
import { DueDate, Empty, ErrorNote, EvidenceLink, Hours, PageHeader, SectionTitle, StagePill, StatusPill, TaskLink } from "@/components/ui";
import { now as clockNow } from "@/lib/dates/clock";

export const dynamic = "force-dynamic";

const CHART_WEEKS = 8;

type Params = { params: Promise<{ project: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { project } = await params;
  return { title: isProjectKey(project) ? projectDef(project).title : "Progress" };
}

export default async function ProjectProgress({ params }: Params) {
  const access = await requireAccess();
  const { project } = await params;
  // Unknown and unshared projects look the same, so nothing leaks about which exist.
  if (!isProjectKey(project) || !canRead(access, project) || !projectGid(project)) notFound();

  const def = projectDef(project);
  const tz = timeZone();
  const now = clockNow();
  const chartSince = midnightIn(addDays(weekOf(now, tz).start, -7 * (CHART_WEEKS - 1)), tz);
  const [tasks, status, asana, sessions] = await Promise.all([
    attempt(() => allTasks(project)),
    attempt(() => latestStatus(project)),
    attempt(() => verifiedProject(project)),
    attempt(() => listSessionComments(chartSince, project)),
  ]);
  const date = today();
  const isOwner = access.role === "owner";
  const overview = usesAsana() || !planFor(project) ? null : await attempt(() => loadStudy());
  const progress = overview?.ok ? (overview.value.plans.find((p) => p.plan.project === project) ?? null) : null;
  const benchmarks = overview?.ok ? overview.value.study.benchmarks.filter((b) => b.project === project) : [];

  if (!tasks.ok) {
    return (
      <div>
        <PageHeader eyebrow={def.area} title={def.title} />
        <ErrorNote title="Could not load this project" message={tasks.error} />
      </div>
    );
  }

  const list = tasks.value;
  const done = list.filter((t) => t.completed);
  const totalHours = list.reduce((sum, t) => sum + t.hours, 0);
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0;
  const recent = [...done]
    .filter((t) => t.completedAt)
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))
    .slice(0, 5);
  const sections = groupBySection(list);

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={def.area} title={def.title}>
        {def.blurb}
        {isOwner && asana.ok && (
          <>
            {" "}
            <TaskLink href={asana.value.url} className="text-aqua hover:underline">
              Open tasks
            </TaskLink>
          </>
        )}
      </PageHeader>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Complete" value={`${pct}%`} detail={`${done.length} of ${list.length} tasks`} bar={pct} />
        <Stat label="Hours logged" value={`${formatHours(Math.round(totalHours * 100) / 100)} h`} detail="Across all tasks" />
        <Stat
          label="Open now"
          value={String(list.length - done.length)}
          detail={`${list.filter((t) => !t.completed && t.stage === "Blocked").length} blocked`}
        />
      </dl>

      {progress?.loaded && (
        <section className="space-y-3">
          <SectionTitle>{progress.plan.title}</SectionTitle>
          <p className="text-sm text-neutral-300">
            {progress.core.done} of {progress.core.total} {progress.plan.unitLabel} finished
            {progress.exercises.total > 0 && `, and ${progress.exercises.solved} of ${progress.exercises.total} exercises solved`}.
            {" "}Optional {progress.plan.unitLabel} are not counted.
          </p>
          {benchmarks.length > 0 && <BenchmarkTable rows={benchmarks} />}
        </section>
      )}

      {sessions.ok && <WeeklyHours weeks={hoursByWeek(sessions.value, CHART_WEEKS, now, tz)} />}

      <section>
        <SectionTitle>Latest status update</SectionTitle>
        {!status.ok ? (
          <ErrorNote message={status.error} />
        ) : status.value ? (
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={status.value.status_type} />
              <span className="font-semibold">{status.value.title}</span>
              <span className="text-xs text-neutral-400">
                {new Date(status.value.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-line text-neutral-300">{status.value.text}</p>
          </div>
        ) : (
          <Empty>No status update yet. They are posted every Sunday.</Empty>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <SectionTitle>Recently finished</SectionTitle>
          <ul className="space-y-2">
            {recent.map((t) => (
              <li key={t.gid} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm">
                <span>{t.name}</span>
                <span className="flex items-center gap-4 text-neutral-400">
                  {t.hours > 0 && <Hours value={t.hours} />}
                  <EvidenceLink href={t.evidence} />
                  <span>{new Date(t.completedAt!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-6">
        <SectionTitle>All tasks</SectionTitle>
        {list.length === 0 && <Empty>No tasks yet.</Empty>}
        {sections.map(([section, items]) => (
          <div key={section} className="card p-0">
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
              <h3 className="font-semibold">{section}</h3>
              <span className="text-xs text-neutral-400">
                {items.filter((t) => t.completed).length} of {items.length} done
              </span>
            </div>
            <ul className="divide-y divide-white/5">
              {items.map((t) => (
                <li key={t.gid} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                  <span className={t.completed ? "text-neutral-400 line-through decoration-neutral-600" : ""}>
                    {isOwner ? (
                      <TaskLink href={t.url} className="hover:underline">
                        {t.name}
                      </TaskLink>
                    ) : (
                      t.name
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-neutral-400">
                    {!t.completed && <DueDate dueOn={t.dueOn} today={date} />}
                    {t.hours > 0 && <Hours value={t.hours} />}
                    <EvidenceLink href={t.evidence} />
                    <StagePill stage={t.completed ? "Done" : t.stage} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Hours per week, one series, so the title names it and no legend is needed. */
function WeeklyHours({ weeks }: { weeks: WeekHours[] }) {
  const peak = Math.max(...weeks.map((w) => w.hours));
  if (peak === 0) return null;
  const latest = weeks.length - 1;
  const peakIndex = weeks.findIndex((w) => w.hours === peak);
  return (
    <section>
      <SectionTitle>Hours per week</SectionTitle>
      <div className="card">
        <div className="flex h-40 items-end gap-1" role="img" aria-label={`Hours per week for the last ${weeks.length} weeks, latest ${formatHours(weeks[latest].hours)}, peak ${formatHours(peak)}.`}>
          {weeks.map((w, i) => (
            <div key={w.start} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`Week of ${shortDate(w.start)}: ${formatHours(w.hours)} h`}>
              {(i === latest || i === peakIndex) && w.hours > 0 && <span className="mb-1 text-xs text-neutral-200 tabular-nums">{formatHours(w.hours)}</span>}
              <div
                className={`w-full max-w-6 rounded-t ${i === latest ? "bg-aqua" : "bg-aqua/50"} group-hover:bg-aqua`}
                style={{ height: `${(w.hours / peak) * 80}%`, minHeight: w.hours > 0 ? 4 : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1 border-t border-white/10 pt-2">
          {weeks.map((w, i) => (
            <span key={w.start} className="flex-1 text-center text-[11px] text-neutral-400">
              {i % 2 === (weeks.length - 1) % 2 ? shortDate(w.start) : ""}
            </span>
          ))}
        </div>
        <table className="sr-only">
          <caption>Hours per week</caption>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}><th scope="row">Week of {shortDate(w.start)}</th><td>{formatHours(w.hours)} h</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, detail, bar }: { label: string; value: string; detail: string; bar?: number }) {
  return (
    <div className="card space-y-1">
      <dt className="text-sm text-neutral-400">{label}</dt>
      <dd className="text-3xl font-bold tabular-nums">{value}</dd>
      <dd className="text-xs text-neutral-400">{detail}</dd>
      {bar !== undefined && (
        <dd className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-royal to-aqua" style={{ width: `${bar}%` }} />
        </dd>
      )}
    </div>
  );
}

function groupBySection(tasks: TaskView[]): [string, TaskView[]][] {
  const groups = new Map<string, TaskView[]>();
  for (const t of tasks) {
    const name = t.section && t.section !== "Untitled section" ? t.section : "Other";
    groups.set(name, [...(groups.get(name) ?? []), t]);
  }
  return [...groups.entries()];
}
