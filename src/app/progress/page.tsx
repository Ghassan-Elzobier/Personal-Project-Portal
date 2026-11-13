import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { projectGid } from "@/lib/config/env";
import { PROJECTS } from "@/lib/config/projects";
import { allTasks, attempt, latestStatus, today } from "@/lib/portal/data";
import { projectStats } from "@/lib/tasks/model";
import { formatHours } from "@/lib/tasks/session-log";
import { Empty, PageHeader, StatusPill } from "@/components/ui";

export const metadata: Metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

export default async function ProgressIndex() {
  const access = await requireAccess();
  const projects = PROJECTS.filter(
    (p) => projectGid(p.key) && (access.role === "owner" || access.projects.includes(p.key)),
  );
  const date = today();
  const rows = await Promise.all(
    projects.map(async (p) => ({
      p,
      tasks: await attempt(() => allTasks(p.key)),
      status: await attempt(() => latestStatus(p.key)),
    })),
  );

  return (
    <div>
      <PageHeader eyebrow="Read-only" title="Progress">
        {access.role === "owner" ? "What mentors see for each project." : "The projects shared with you."}
      </PageHeader>
      {projects.length === 0 && <Empty>No projects to show yet.</Empty>}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map(({ p, tasks, status }) => {
          const stats = tasks.ok ? projectStats(tasks.value, date) : null;
          return (
            <li key={p.key}>
              <Link href={`/progress/${p.key}`} className="card-link h-full space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{p.area}</p>
                    <p className="text-xl font-semibold">{p.title}</p>
                  </div>
                  {status.ok && status.value && <StatusPill status={status.value.status_type} />}
                </div>
                <p className="text-sm text-neutral-400">{p.blurb}</p>
                {stats && stats.total > 0 && (
                  <>
                    <p className="text-sm text-neutral-300 tabular-nums">
                      {stats.percent}% done, {stats.done} of {stats.total} tasks, {formatHours(stats.hours)} h
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                      <div className="h-full rounded-full bg-mint" style={{ width: `${stats.percent}%` }} />
                    </div>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
