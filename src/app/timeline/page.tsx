import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth/access";
import { projectGid } from "@/lib/config/env";
import { allTasks, attempt, today, type TaskView } from "@/lib/portal/data";
import { PROJECTS } from "@/lib/config/projects";
import { addDays, shortDate, weekdayIndex } from "@/lib/dates/week";
import { Empty, ErrorNote, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Timeline" };
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

const BAR: Record<string, string> = {
  "Not started": "bg-white/15",
  "In progress": "bg-gradient-to-r from-royal to-aqua",
  Blocked: "bg-coral/70",
  "Needs review": "bg-sand/70",
  Done: "bg-mint/50",
};

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const access = await requireAccess();
  const { from } = await searchParams;
  const projects = PROJECTS.filter((p) => projectGid(p.key) && (access.role === "owner" || access.projects.includes(p.key)));
  const results = await Promise.all(projects.map(async (p) => ({ p, tasks: await attempt(() => allTasks(p.key)) })));

  const date = today();
  const dated = results.flatMap((r) => (r.tasks.ok ? r.tasks.value.filter((t) => t.dueOn) : []));

  // Window: from two weeks back (or ?from=) to the last due date, 6 to 26 weeks wide, Monday-aligned.
  const earliest = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : addDays(date, -14);
  const start = addDays(earliest, -weekdayIndex(earliest));
  const lastDue = dated.reduce((max, t) => (t.dueOn! > max ? t.dueOn! : max), date);
  const weeks = Math.min(26, Math.max(6, Math.ceil((dayNumber(lastDue) - dayNumber(start) + 7) / 7)));
  const totalDays = weeks * 7;
  const end = addDays(start, totalDays - 1);
  const pct = (d: string) => ((dayNumber(d) - dayNumber(start)) / totalDays) * 100;
  const isOwner = access.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`${shortDate(start)} to ${shortDate(end)}`} title="Timeline">
        Every dated task and milestone across {isOwner ? "your projects" : "the projects shared with you"}.
        Bars run from a task&apos;s start date to its due date; diamonds are milestones.
      </PageHeader>

      {projects.length === 0 && <Empty>No projects to show yet.</Empty>}

      <div className="card overflow-x-auto p-0">
        <div className="min-w-[56rem]">
          <div className="relative ml-56 h-8 border-b border-white/5">
            {Array.from({ length: weeks }, (_, i) => addDays(start, i * 7)).map((w) => (
              <span
                key={w}
                className="absolute top-2 border-l border-white/10 pl-1 text-[11px] text-neutral-500"
                style={{ left: `${pct(w)}%` }}
              >
                {shortDate(w)}
              </span>
            ))}
          </div>

          {results.map(({ p, tasks }) => (
            <section key={p.key} className="border-b border-white/5 last:border-0">
              <h2 className="sticky left-0 px-5 pt-4 pb-2 text-sm font-semibold">
                {p.title} <span className="font-normal text-neutral-500">· {p.area}</span>
              </h2>
              {!tasks.ok ? (
                <div className="px-5 pb-4">
                  <ErrorNote message={tasks.error} />
                </div>
              ) : (
                <Rows tasks={tasks.value} pct={pct} start={start} end={end} today={date} isOwner={isOwner} />
              )}
            </section>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-neutral-400">
        {Object.entries(BAR).map(([stage, cls]) => (
          <span key={stage} className="flex items-center gap-2">
            <span className={`h-2 w-5 rounded-full ${cls}`} /> {stage}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span className="h-3 w-0.5 bg-coral" /> Today
        </span>
      </div>
    </div>
  );
}

function Rows({
  tasks,
  pct,
  start,
  end,
  today,
  isOwner,
}: {
  tasks: TaskView[];
  pct: (d: string) => number;
  start: string;
  end: string;
  today: string;
  isOwner: boolean;
}) {
  const inRange = tasks
    .filter((t) => t.dueOn && t.dueOn >= start && (t.startOn ?? t.dueOn) <= end)
    .sort((a, b) => (a.startOn ?? a.dueOn!).localeCompare(b.startOn ?? b.dueOn!));
  const undated = tasks.filter((t) => !t.dueOn).length;
  const todayLeft = pct(today);

  if (inRange.length === 0) {
    return (
      <p className="px-5 pb-4 text-sm text-neutral-500">
        Nothing dated in this window.{undated ? ` ${undated} tasks have no dates yet.` : ""}
      </p>
    );
  }

  return (
    <ul className="pb-3">
      {inRange.map((t) => {
        const from = t.startOn && t.startOn < t.dueOn! ? t.startOn : t.dueOn!;
        const left = Math.max(0, pct(from));
        const right = Math.min(100, pct(addDays(t.dueOn!, 1)));
        const stage = t.completed ? "Done" : (t.stage ?? "Not started");
        const label = isOwner ? (
          <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">
            {t.name}
          </a>
        ) : (
          t.name
        );
        return (
          <li key={t.gid} className="group flex h-8 items-center">
            <span
              className={`w-56 shrink-0 truncate px-5 text-xs ${t.completed ? "text-neutral-500 line-through" : "text-neutral-300"}`}
              title={t.name}
            >
              {label}
            </span>
            <span className="relative h-full flex-1">
              {todayLeft >= 0 && todayLeft <= 100 && (
                <span className="absolute inset-y-0 w-0.5 bg-coral/70" style={{ left: `${todayLeft}%` }} aria-hidden />
              )}
              {t.milestone ? (
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-lavender ring-2 ring-primary"
                  style={{ left: `${pct(t.dueOn!) + (right - pct(t.dueOn!)) / 2}%` }}
                  title={`${t.name}, ${shortDate(t.dueOn!)}`}
                />
              ) : (
                <span
                  className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${BAR[stage] ?? BAR["Not started"]}`}
                  style={{ left: `${left}%`, width: `${Math.max(right - left, 0.6)}%` }}
                  title={`${t.name}: ${from === t.dueOn ? shortDate(t.dueOn!) : `${shortDate(from)} to ${shortDate(t.dueOn!)}`}`}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
