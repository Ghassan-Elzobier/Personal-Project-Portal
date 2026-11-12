import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/access";
import { usesAsana } from "@/lib/config/env";
import { shortDate } from "@/lib/dates/week";
import { loadStudy } from "@/lib/study/load";
import { PLANS } from "@/lib/study/plans";
import { recallSummary, shareRoadmap, type SharedPhase } from "@/lib/study/shared-roadmap";
import { formatHours } from "@/lib/tasks/session-log";
import { Empty, PageHeader, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Roadmap" };
export const dynamic = "force-dynamic";

/** The study roadmap, read-only, for mentors. The owner sees it here as mentors do. */
export default async function SharedRoadmapPage() {
  const access = await requireAccess();
  if (usesAsana()) notFound();
  const owner = access.role === "owner";
  const studyProjects: string[] = PLANS.map((p) => p.project);
  const projects = owner ? studyProjects : studyProjects.filter((k) => (access.projects as string[]).includes(k));

  const header = (
    <PageHeader eyebrow="Read-only" title="Study roadmap">
      {owner
        ? "What a mentor sees. Each mentor sees only the plans you share with them on People."
        : "PMPP, Linear Algebra Done Right and a Vulkan renderer, worked through as one path in eight phases."}
    </PageHeader>
  );
  if (!projects.length) {
    return (
      <div className="space-y-6">
        {header}
        <Empty>No study plans are shared with you yet.</Empty>
      </div>
    );
  }

  const overview = await loadStudy();
  const visible = overview.plans.filter((p) => projects.includes(p.plan.project));
  const dueOn = new Map(visible.flatMap((p) => p.rows.map((r) => [r.unit.ref, r.task.dueOn] as const)));
  const shared = shareRoadmap(overview.roadmap, { projects, dueOn, today: overview.today });
  const taskProject = new Map(visible.flatMap((p) => p.rows.map((r) => [r.task.gid, r.task.project] as const)));
  const recall = recallSummary(overview.study.reviews.filter((r) => taskProject.has(r.task_gid)), overview.today);
  const hours = visible.reduce((sum, p) => sum + p.hours, 0);
  const exercises = visible.reduce((sum, p) => sum + p.exercises.solved, 0);

  return (
    <div className="space-y-8">
      {header}

      <dl className="card grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Now" value={shared.current ? `Phase ${shared.current.index + 1} of 8` : "All done"} detail={shared.current?.name ?? ""} />
        <Stat label="Main path" value={`${shared.done} of ${shared.total}`} detail={`units done, about ${Math.round(shared.hoursLeft)} h left`} />
        <Stat
          label="Finish"
          value={shared.finishOn ? shortDate(shared.finishOn) : "Not dated"}
          detail={shared.finishOn ? (shared.overdue.length ? `${shared.overdue.length} overdue now` : "On schedule today") : `${shared.undated} units have no date yet`}
        />
        <Stat label="Logged" value={`${formatHours(Math.round(hours * 100) / 100)} h`} detail={`${exercises} exercises solved`} />
      </dl>

      <p className="text-sm text-neutral-300">
        {recall.reviewed
          ? `Recall practice in the last ${recall.days} days: ${recall.reviewed} ${recall.reviewed === 1 ? "review" : "reviews"}, ${recall.got} remembered, ${recall.shaky} shaky, ${recall.missed} missed.`
          : `No recall practice in the last ${recall.days} days. Reviews start once a unit is finished.`}
      </p>

      {shared.overdue.length > 0 && (
        <section aria-labelledby="overdue-title" className="space-y-2">
          <SectionTitle><span id="overdue-title">Overdue</span></SectionTitle>
          <ul className="space-y-1 text-sm">
            {shared.overdue.map((u) => (
              <li key={u.ref}>
                {u.name} <span className="text-coral">was due {shortDate(u.dueOn as string)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="phases-title" className="space-y-3">
        <SectionTitle><span id="phases-title">Phases</span></SectionTitle>
        {shared.phases.map((p) => (
          <SharedPhaseCard key={p.index} phase={p} today={overview.today} />
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
      {detail && <dd className="text-xs text-neutral-400">{detail}</dd>}
    </div>
  );
}

function SharedPhaseCard({ phase: p, today }: { phase: SharedPhase; today: string }) {
  const label = `Phase ${p.index + 1} of 8`;
  return (
    <details open={p.state === "now"} className={`group/phase ${p.state === "now" ? "card" : "rounded-xl bg-white/5 p-4 ring-1 ring-white/5"}`}>
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span>
          <span className="mr-2 inline-block text-xs text-neutral-400 transition-transform group-open/phase:rotate-90" aria-hidden>▸</span>
          <span className="eyebrow mr-2">{p.state === "now" ? `Now: ${label}` : p.state === "done" ? `${label}, done` : label}</span>
          <h3 className="inline font-semibold">{p.name}</h3>
        </span>
        <span className="text-xs text-neutral-400 tabular-nums">
          {p.done} of {p.total} done{p.hoursLeft > 0 ? `, about ${Math.round(p.hoursLeft)} h left` : ""}
        </span>
      </summary>
      <div className="mt-3 space-y-4">
        <p className="max-w-3xl text-sm text-neutral-300">{p.why}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {p.tracks.map((t) => (
            <div key={t.project}>
              <h4 className="mb-1 text-sm font-semibold">{t.title}</h4>
              <ul className="space-y-1 text-sm">
                {t.units.map((u) => (
                  <li key={u.ref} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-3 text-mint" aria-hidden>{u.done ? "✓" : ""}</span>
                    <span className={u.done ? "text-neutral-400" : ""}>
                      {u.name}
                      {u.done && <span className="sr-only"> (done)</span>}
                    </span>
                    {u.optional && <span className="text-xs text-neutral-400">optional</span>}
                    {!u.done && u.dueOn && <span className={`text-xs ${u.dueOn < today ? "text-coral" : "text-neutral-400"}`}>{u.dueOn < today ? `overdue, ${shortDate(u.dueOn)}` : `due ${shortDate(u.dueOn)}`}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm">
          <span className="font-semibold">Done when: </span>
          <span className="text-neutral-300">{p.exit}</span>
        </p>
        {p.links.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-neutral-300 hover:text-white">How the plans connect here</summary>
            <ul className="mt-2 space-y-1 text-sm text-neutral-300">
              {p.links.map((l, i) => (
                <li key={i}><span className="text-white">{l.aShort} and {l.bShort}:</span> {l.why}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}
