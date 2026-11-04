import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { projectGid } from "@/lib/config/env";
import { attempt, thisWeek, weekSummary } from "@/lib/portal/data";
import { PROJECTS } from "@/lib/config/projects";
import { shortDate } from "@/lib/dates/week";
import { Empty, ErrorNote, Hours, PageHeader, StatusPill } from "@/components/ui";
import { DraftForm } from "./draft-form";

export const metadata: Metadata = { title: "Sunday update" };
export const dynamic = "force-dynamic";

export default async function WeekPage() {
  await requireOwner();
  const week = thisWeek();
  const configured = PROJECTS.filter((p) => projectGid(p.key));
  const study = await Promise.all(
    configured
      .filter((p) => p.key !== "weekly-log")
      .map(async (p) => ({ p, s: await attempt(() => weekSummary(p.key, week)) })),
  );
  const totalHours =
    Math.round(study.reduce((sum, { s }) => sum + (s.ok ? s.value.hours : 0), 0) * 100) / 100;
  // The weekly log's update reports every project's hours, so it goes last.
  const weekly = configured.find((p) => p.key === "weekly-log");
  const summaries = weekly
    ? [...study, { p: weekly, s: await attempt(() => weekSummary("weekly-log", week, { studyHours: totalHours })) }]
    : study;

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={`Week of ${shortDate(week.start)} to ${shortDate(week.end)}`} title="Sunday update">
        Each draft comes from this week&apos;s logged sessions and task changes. Edit the &quot;Blocked / questions&quot;
        line, since that is the one mentors read most, then post it.
      </PageHeader>

      <p className="text-sm text-neutral-400">
        Study hours logged this week: <span className="text-white">{totalHours} h</span>
      </p>

      {configured.length === 0 && <Empty>No projects are configured yet.</Empty>}

      <ul className="space-y-6">
        {summaries.map(({ p, s }) => (
          <li key={p.key} className="card space-y-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{p.area}</p>
                <h2 className="text-2xl font-semibold">{p.title}</h2>
              </div>
              {s.ok && s.value.posted && (
                <span className="flex items-center gap-2 text-sm text-mint">
                  Posted <StatusPill status={s.value.posted.status_type} />
                </span>
              )}
            </div>

            {!s.ok ? (
              <ErrorNote message={s.error} />
            ) : (
              <>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-xl bg-white/5 p-3">
                    <dt className="text-neutral-400">Hours</dt>
                    <dd className="text-xl font-semibold">
                      <Hours value={s.value.hours} />
                    </dd>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3">
                    <dt className="text-neutral-400">Finished</dt>
                    <dd className="text-xl font-semibold">{s.value.done.length}</dd>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3">
                    <dt className="text-neutral-400">Blocked or in review</dt>
                    <dd className="text-xl font-semibold">{s.value.blocked.length}</dd>
                  </div>
                </dl>
                <DraftForm
                  project={p.key}
                  draft={s.value.draft}
                  suggested={s.value.suggestedStatus}
                  postedText={s.value.posted?.text ?? null}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
