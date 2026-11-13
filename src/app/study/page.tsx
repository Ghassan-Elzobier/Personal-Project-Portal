import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { timeZone, usesAsana, weeklyHoursTarget } from "@/lib/config/env";
import { projectDef } from "@/lib/config/projects";
import { loadJobBoard, phaseMarket, unitMarket, type JobBoard } from "@/lib/jobs/load";
import { attempt } from "@/lib/portal/data";
import { recentCommits } from "@/lib/study/github";
import { loadStudy, panelFor, type PlanProgress, type StudyOverview, type UnitRow } from "@/lib/study/load";
import { listComments } from "@/lib/tasks/native";
import { bookHref } from "@/lib/library/links";
import { formatHours } from "@/lib/tasks/session-log";
import { StartSessionButton } from "@/components/session-timer";
import { DueDate, Empty, PageHeader, SectionTitle, StagePill } from "@/components/ui";
import { TaskPane } from "../tasks/task-pane";
import { BenchmarkForm, BenchmarkHistory } from "./benchmark-form";
import { BenchmarkTable } from "./benchmarks";
import { LoadPlanButton, PaceForm } from "./plan-controls";
import { ReviewQueue } from "./review-queue";
import { RoadmapTab, RoadmapView } from "./roadmap-view";
import { StudyPanel } from "./study-panel";

export const metadata: Metadata = { title: "Study" };
export const dynamic = "force-dynamic";

type Search = { project?: string; task?: string };

export default async function StudyPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireOwner();
  if (usesAsana()) notFound();

  const params = await searchParams;
  const overview = await loadStudy();
  // With no plan chosen, the page opens on the roadmap across all three.
  const current = overview.plans.find((p) => p.plan.project === params.project) ?? null;
  const href = (next: Search) =>
    `/study?${new URLSearchParams({ ...(current ? { project: current.plan.project } : {}), ...next })}`;

  const selected = params.task
    ? overview.plans.flatMap((p) => p.rows).find((r) => r.task.gid === params.task)
    : undefined;
  const comments = selected ? await attempt(() => listComments(selected.task.gid)) : null;
  const commits = current?.plan.mode === "lab" && current.loaded ? await recentCommits() : [];
  // What the market says about each unit. The page works the same without it.
  const loadedBoard = await attempt(() => loadJobBoard(overview));
  const board = loadedBoard.ok ? loadedBoard.value : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Study" />

      <nav aria-label="Plans" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RoadmapTab roadmap={overview.roadmap} active={!current} />
        {overview.plans.map((p) => (
          <PlanTab key={p.plan.project} progress={p} active={p === current} />
        ))}
      </nav>

      <ReviewQueue due={overview.due} today={overview.today} />

      {!current ? (
        <RoadmapView
          roadmap={overview.roadmap}
          today={overview.today}
          defaultHours={weeklyHoursTarget() ?? 12}
          market={board ? phaseMarket(board) : undefined}
        />
      ) : current.loaded ? (
        <PlanView progress={current} overview={overview} href={href} commits={commits} board={board} />
      ) : (
        <LoadCard progress={current} />
      )}

      {selected && (
        <TaskPane
          key={selected.task.gid}
          closeHref={current ? `/study?${new URLSearchParams({ project: selected.task.project })}` : "/study"}
          timeZone={timeZone()}
          task={{
            gid: selected.task.gid,
            name: selected.task.name,
            completed: selected.task.completed,
            dueOn: selected.task.dueOn,
            stage: selected.task.stage ?? "Not started",
            hours: selected.task.hours,
            evidence: selected.task.evidence,
            milestone: selected.task.milestone,
            notes: selected.task.notes,
            sectionGid: selected.task.sectionGid,
          }}
          sections={overview.sections(selected.task.project)}
          comments={
            comments?.ok ? comments.value.map((c) => ({ gid: c.gid, text: c.text, createdAt: c.created_at })) : []
          }
          loadError={comments && !comments.ok ? comments.error : null}
        >
          <StudyPanel
            data={{ ...panelFor(selected, overview.study), market: board ? unitMarket(board, selected.unit.ref) : [] }}
          />
        </TaskPane>
      )}
    </div>
  );
}

function PlanTab({ progress, active }: { progress: PlanProgress; active: boolean }) {
  const { plan, core, loaded } = progress;
  const percent = core.total ? Math.round((core.done / core.total) * 100) : 0;
  return (
    <Link
      href={`/study?project=${plan.project}`}
      aria-current={active ? "page" : undefined}
      className={`block rounded-xl p-3 ring-1 transition hover:ring-white/25 ${active ? "bg-lavender/15 ring-lavender" : "bg-white/5 ring-white/5"}`}
    >
      <span className="block text-sm font-semibold">{projectDef(plan.project).title}</span>
      {loaded ? (
        <>
          <span className="block text-xs text-body tabular-nums">
            {core.done} of {core.total} {plan.unitLabel}
          </span>
          <span
            className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"
            role="img"
            aria-label={`${percent}% done`}
          >
            <span className="block h-full rounded-full bg-mint" style={{ width: `${percent}%` }} />
          </span>
        </>
      ) : (
        <span className="text-xs text-muted">Not loaded yet</span>
      )}
    </Link>
  );
}

function LoadCard({ progress }: { progress: PlanProgress }) {
  const { plan } = progress;
  const count = plan.sections.flatMap((s) => s.units);
  const exercises = count.reduce((sum, u) => sum + (u.exercises ?? 0), 0);
  return (
    <section className="space-y-3 card-special">
      <div>
        <h2 className="text-xl font-semibold">{plan.title}</h2>
        <p className="text-sm text-white/80">{plan.subtitle}</p>
      </div>
      <p className="max-w-2xl text-sm text-white/90">{plan.guidance}</p>
      <p className="text-sm text-white/90">
        Adds {count.length} {plan.unitLabel}, each with its steps
        {exercises ? `, plus ${exercises} exercises to track` : ""}. You can edit or delete anything afterwards.
      </p>
      <LoadPlanButton
        project={plan.project}
        label={`Load ${projectDef(plan.project).title}`}
        className="btn bg-white/15 hover:bg-white/25"
      />
    </section>
  );
}

function PlanView({
  progress,
  overview,
  href,
  commits,
  board,
}: {
  progress: PlanProgress;
  overview: StudyOverview;
  href: (next: Search) => string;
  commits: Awaited<ReturnType<typeof recentCommits>>;
  board: JobBoard | null;
}) {
  const { plan, core, exercises, hours, next, rows, missing, others } = progress;
  const remaining = rows.filter((r) => !r.unit.optional && !r.task.completed);
  const undated = remaining.filter((r) => !r.task.dueOn).length;
  const benchmarks = overview.study.benchmarks.filter((b) => b.project === plan.project);

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-xl font-semibold">
            {plan.title} <span className="text-sm font-normal text-muted">{plan.subtitle}</span>
          </h2>
          <p className="flex flex-wrap gap-x-4 text-sm">
            {plan.sourceUrl && (
              <a href={plan.sourceUrl()} target="_blank" rel="noreferrer" className="text-aqua hover:underline">
                {plan.mode === "lab" ? "Open the repo" : "Open the book"}
              </a>
            )}
            {plan.project === "rendering" && (
              <Link href="/lab" className="text-aqua hover:underline">
                How it works
              </Link>
            )}
            {plan.project === "pmpp" && (
              <Link href="/library" className="text-aqua hover:underline">
                Read the book here
              </Link>
            )}
            {plan.extraLinks?.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-aqua hover:underline">
                {l.label}
              </a>
            ))}
          </p>
        </div>
        <p className="text-sm text-body tabular-nums">
          {core.done} of {core.total} {plan.unitLabel}
          {exercises.total > 0 && `, ${exercises.solved} of ${exercises.total} exercises solved`}
          {exercises.stuck > 0 && `, ${exercises.stuck} stuck`}
          {plan.mode === "lab" && `, ${benchmarks.length} ${benchmarks.length === 1 ? "result" : "results"} recorded`}
          {`, ${formatHours(hours)} h logged`}
        </p>
        {plan.project === "pmpp" && (
          <form action="/library" role="search" className="flex max-w-xl gap-2">
            <label htmlFor="ask-book" className="sr-only">
              Search the book
            </label>
            <input
              id="ask-book"
              name="q"
              placeholder="Search PMPP: warp divergence, subgroup ballot…"
              className="field-input mt-0"
            />
            <button className="btn-ghost shrink-0 px-4 py-1.5">Search</button>
          </form>
        )}
        <details className="text-sm text-body">
          <summary className="cursor-pointer hover:text-white">How to work through this</summary>
          <p className="mt-2 max-w-3xl">{plan.guidance}</p>
        </details>
      </div>

      {next ? (
        <NextUp
          row={next}
          href={href}
          today={overview.today}
          plan={plan}
          market={board ? unitMarket(board, next.unit.ref) : []}
        />
      ) : (
        <Empty>Everything in the main path is done. The optional ones are still here.</Empty>
      )}

      {remaining.length > 0 && (
        <details open={undated === remaining.length}>
          <summary className="cursor-pointer text-sm text-body hover:text-white">
            {undated === remaining.length ? "Set a pace" : "Change the pace"}
          </summary>
          <div className="mt-3">
            <PaceForm
              project={plan.project}
              remaining={remaining.length}
              label={plan.unitLabel}
              defaultPerWeek={plan.defaultPerWeek}
              today={overview.today}
              dated={remaining.length - undated}
            />
          </div>
        </details>
      )}

      {plan.mode === "lab" && (
        <section className="space-y-3" aria-labelledby="results-title">
          <SectionTitle>
            <span id="results-title">Results</span>
          </SectionTitle>
          {benchmarks.length === 0 && (
            <Empty>
              No results yet. Start by measuring the renderer as it is today, so every later change has something to
              beat.
            </Empty>
          )}
          <BenchmarkTable rows={benchmarks} />
          <details open={benchmarks.length === 0}>
            <summary className="cursor-pointer text-sm text-body hover:text-white">Record a result</summary>
            <div className="mt-3">
              <BenchmarkForm
                project={plan.project}
                commits={commits}
                units={rows.map((r) => ({ gid: r.task.gid, name: r.task.name }))}
                defaultTask={next?.task.gid ?? ""}
                last={benchmarks.at(-1) ?? null}
              />
            </div>
          </details>
          <BenchmarkHistory rows={benchmarks} />
        </section>
      )}

      <div className="space-y-4">
        {plan.sections.map((section) => {
          const inSection = section.units.flatMap((u) => rows.find((r) => r.unit.ref === u.ref) ?? []);
          if (!inSection.length) return null;
          const done = inSection.filter((r) => r.task.completed).length;
          return (
            <details key={section.name} open={done < inSection.length} className="group/section">
              <summary className="flex cursor-pointer items-baseline justify-between gap-4 border-b border-white/10 pb-2">
                <h3 className="font-semibold">{section.name}</h3>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {done} of {inSection.length}
                </span>
              </summary>
              <ul className="divide-y divide-white/5">
                {inSection.map((row) => (
                  <UnitRowView key={row.unit.ref} row={row} href={href} today={overview.today} plan={plan} />
                ))}
              </ul>
            </details>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        {others > 0 && (
          <Link href={`/tasks?project=${plan.project}`} className="hover:text-white">
            {others} more {others === 1 ? "task" : "tasks"} in this project, outside the plan
          </Link>
        )}
        {missing > 0 && (
          <LoadPlanButton
            project={plan.project}
            label={`Add ${missing} missing from the plan`}
            className="btn-ghost px-4 py-1.5"
          />
        )}
      </div>
    </>
  );
}

function NextUp({
  row,
  href,
  today,
  plan,
  market,
}: {
  row: UnitRow;
  href: (next: Search) => string;
  today: string;
  plan: PlanProgress["plan"];
  market: ReturnType<typeof unitMarket>;
}) {
  const { task, unit } = row;
  const unfinished = row.needs.filter((n) => !n.done);
  return (
    <section aria-label="Next up" className="space-y-3 card">
      <div>
        <p className="eyebrow">Next up</p>
        <Link href={href({ task: task.gid })} scroll={false} className="text-lg font-semibold hover:underline">
          {task.name}
        </Link>
      </div>
      {task.notes && <p className="line-clamp-3 max-w-3xl text-sm text-body">{task.notes}</p>}
      {market.length > 0 && (
        <p className="text-sm text-body">
          Why it matters: teaches{" "}
          {market
            .slice(0, 3)
            .map((m) => `${m.name} (${m.must + m.soft} ${m.must + m.soft === 1 ? "role" : "roles"})`)
            .join(", ")}
          .{" "}
          <Link href="/jobs?view=skills" className="text-aqua underline-offset-4 hover:underline">
            See the market
          </Link>
        </p>
      )}
      {unfinished.length > 0 && (
        <p className="text-sm text-sand">
          Do these first:{" "}
          {unfinished.map((n, i) => (
            <span key={n.href}>
              {i > 0 && ", "}
              <Link href={n.href} scroll={false} className="underline-offset-4 hover:underline">
                {n.short}
              </Link>
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StartSessionButton gid={task.gid} name={task.name} className="btn-primary px-4 py-1.5" />
        <Link href={`/log?task=${task.gid}`} className="btn-ghost px-4 py-1.5">
          Log a session
        </Link>
        {plan.sourceUrl && unit.page && (
          <a href={plan.sourceUrl(unit.page)} target="_blank" rel="noreferrer" className="btn-ghost px-4 py-1.5">
            Open at page {unit.page}
          </a>
        )}
        {!plan.sourceUrl && unit.page && (
          <Link href={bookHref.page(unit.page)} className="btn-ghost px-4 py-1.5">
            Read from page {unit.page}
          </Link>
        )}
        <DueDate dueOn={task.dueOn} today={today} />
      </div>
    </section>
  );
}

function UnitRowView({
  row,
  href,
  today,
  plan,
}: {
  row: UnitRow;
  href: (next: Search) => string;
  today: string;
  plan: PlanProgress["plan"];
}) {
  const { task, unit, tally, stepsDone, stepsTotal } = row;
  const unfinished = row.needs.filter((n) => !n.done);
  const count = task.exerciseCount;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
      <span className="w-4 shrink-0 text-center text-mint" aria-hidden>
        {task.completed ? "✓" : ""}
      </span>
      <div className="min-w-48 flex-1">
        <Link
          href={href({ task: task.gid })}
          scroll={false}
          className={`hover:underline ${task.completed ? "text-muted" : ""}`}
        >
          {task.milestone && (
            <span className="mr-1 text-lavender" title="Milestone">
              ◆
            </span>
          )}
          {task.name}
          {task.completed && <span className="sr-only"> (done)</span>}
        </Link>
        {unit.optional && <span className="ml-2 text-xs text-muted">optional</span>}
        {unfinished.length > 0 && !task.completed && (
          <p className="text-xs text-muted">After {unfinished.map((n) => n.short).join(", ")}</p>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-body tabular-nums">
        {!task.completed && task.stage && task.stage !== "Not started" && <StagePill stage={task.stage} />}
        {!task.completed && <DueDate dueOn={task.dueOn} today={today} />}
        {stepsTotal > 0 && !task.completed && stepsDone > 0 && (
          <span>
            {stepsDone} of {stepsTotal} steps
          </span>
        )}
        {count ? (
          <span
            className="flex items-center gap-2"
            title={`${tally.solved} solved, ${tally.hint} with a hint, ${tally.stuck} stuck`}
          >
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <span
                className="block h-full rounded-full bg-mint"
                style={{ width: `${Math.min(100, (tally.solved / count) * 100)}%` }}
              />
            </span>
            {tally.solved}/{count}
            {tally.stuck > 0 && <span className="text-coral">{tally.stuck} stuck</span>}
          </span>
        ) : null}
        {plan.sourceUrl && unit.page && (
          <a
            href={plan.sourceUrl(unit.page)}
            target="_blank"
            rel="noreferrer"
            className="text-aqua hover:underline"
            aria-label={`Open ${task.name} at page ${unit.page}`}
          >
            p. {unit.page}
          </a>
        )}
        {!plan.sourceUrl && unit.page && (
          <Link
            href={bookHref.page(unit.page)}
            className="text-aqua hover:underline"
            aria-label={`Read ${task.name} from page ${unit.page}`}
          >
            p. {unit.page}
          </Link>
        )}
        {task.hours > 0 && <span>{formatHours(task.hours)} h</span>}
      </span>
    </li>
  );
}
