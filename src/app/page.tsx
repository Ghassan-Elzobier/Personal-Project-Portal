import Link from "next/link";
import { requireAccess, type Access } from "@/lib/auth/access";
import { configProblems, projectGid, timeZone, usesAsana, weeklyHoursTarget } from "@/lib/config/env";
import { PROJECTS, projectDef, type ProjectKey } from "@/lib/config/projects";
import { addDays, shortDate, weekdayIndex, zonedParts } from "@/lib/dates/week";
import { allTasks, attempt, bucketForToday, latestStatus, openTasks, thisWeek, today } from "@/lib/portal/data";
import { loadScheduleWeek } from "@/lib/portal/schedule";
import { studyTotals } from "@/lib/portal/stats";
import { formatHours } from "@/lib/tasks/session-log";
import { studySnapshot } from "@/lib/tasks/native";
import { hubFrom, loadJobBoard } from "@/lib/jobs/load";
import { mentorJobView, type MentorSource } from "@/lib/jobs/mentor";
import { shareRoadmap } from "@/lib/study/shared-roadmap";
import { createClient } from "@/lib/supabase/server";
import { loadStudy } from "@/lib/study/load";
import { findUnit, PLANS } from "@/lib/study/plans";
import { listSessionComments, listStatusUpdates, listTasks } from "@/lib/tasks/tracker";
import { projectStats } from "@/lib/tasks/model";
import { Empty, ErrorNote, Hours, PageHeader, SectionTitle, StatusPill, TaskLink } from "@/components/ui";
import { QuickAddButton } from "@/components/quick-add";
import { FocusList, type FocusGroup, type FocusTask } from "./focus-list";
import { loadLife } from "@/lib/life/load";
import { yourDay } from "@/lib/portal/day";
import { YourDay } from "./your-day";
import { HubCard } from "./jobs/hub-card";

export const dynamic = "force-dynamic";

type Attention = { text: string; href?: string; tone: "coral" | "sand" | "aqua" };

export default async function HomePage() {
  const access = await requireAccess();
  return access.role === "owner" ? <OwnerHome /> : <MentorHome access={access} />;
}

// ---------------------------------------------------------------------------
// Owner: today
// ---------------------------------------------------------------------------

async function OwnerHome() {
  const date = today();
  const week = thisWeek();
  const tz = timeZone();
  const now = zonedParts(new Date(), tz).minutes;
  const configured = PROJECTS.filter((p) => projectGid(p.key));
  // Read once: the Schedule arranges the Life plan from it too.
  const lifeLoad = loadLife();

  const [perProject, comments, schedule, study, overview, life] = await Promise.all([
    Promise.all(
      configured.map(async (p) => {
        const [open, posted, finished] = await Promise.all([
          attempt(() => openTasks(p.key)),
          attempt(async () => (await listStatusUpdates(p.key, week.startsAt)).length > 0),
          attempt(async () =>
            (await listTasks(p.key, { completedSince: week.startsAt })).filter(
              (t) => t.completed && t.completed_at && new Date(t.completed_at) >= week.startsAt,
            ),
          ),
        ]);
        return { key: p.key, open, posted, finished };
      }),
    ),
    attempt(() => listSessionComments(week.startsAt)),
    attempt(() => loadScheduleWeek(week, { life: lifeLoad })),
    usesAsana() ? null : attempt(() => studySnapshot()),
    usesAsana() ? null : attempt(() => loadStudy()),
    lifeLoad,
  ]);
  // A problem with the job tracker must never take the rest of Today down with it.
  const board = overview?.ok ? await attempt(() => loadJobBoard(overview.value)) : null;
  const hub = overview?.ok && board?.ok ? hubFrom(board.value, overview.value) : null;

  const open = perProject.flatMap((p) => (p.open.ok ? p.open.value : []));
  const buckets = bucketForToday(open, date);
  const totals = comments.ok ? studyTotals(comments.value, week, date, tz) : null;
  const target = weeklyHoursTarget();
  const finishedCount = perProject.reduce((sum, p) => sum + (p.finished.ok ? p.finished.value.length : 0), 0);
  const native = !usesAsana();

  const attention: Attention[] = [];
  for (const problem of configProblems()) attention.push({ text: problem, tone: "sand" });
  for (const p of perProject) {
    if (!p.open.ok) attention.push({ text: `${projectDef(p.key).title}: ${p.open.error}`, tone: "coral" });
  }
  for (const t of buckets.blocked) {
    attention.push({ text: `Blocked: ${t.name}. Ask for help or split it.`, href: t.url, tone: "coral" });
  }
  // From Saturday, nudge about the Sunday update for each project not yet posted.
  if (weekdayIndex(date) >= 5) {
    const missing = perProject.filter((p) => p.posted.ok && !p.posted.value).map((p) => projectDef(p.key).title);
    if (missing.length) {
      attention.push({ text: `Sunday update not posted yet for ${missing.join(", ")}.`, href: "/week", tone: "sand" });
    }
  }
  const reviewsDue = study?.ok ? study.value.reviews.filter((r) => r.due_on && r.due_on <= date).length : 0;
  if (reviewsDue > 0) {
    attention.push({ text: `${reviewsDue} ${reviewsDue === 1 ? "thing" : "things"} to recall today. Short and worth doing first.`, href: "/study", tone: "aqua" });
  }
  for (const a of hub?.actions ?? []) {
    if (a.next_action_on && a.next_action_on <= date) {
      attention.push({ text: `Job hunt: ${a.next_action}, ${a.company}.`, href: `/jobs?view=applications&role=${a.gid}`, tone: a.next_action_on < date ? "coral" : "sand" });
    }
  }
  const noEvidence = perProject.flatMap((p) =>
    p.finished.ok
      ? p.finished.value.filter((t) => !t.custom_fields.find((f) => f.name === "Evidence")?.text_value).map((t) => t.gid)
      : [],
  );
  if (noEvidence.length === 1) {
    attention.push({ text: "A task you finished this week has no evidence link. Mentors click Evidence to check the work.", href: `/log?task=${noEvidence[0]}`, tone: "aqua" });
  } else if (noEvidence.length > 1) {
    attention.push({ text: `${noEvidence.length} tasks you finished this week have no evidence link. Mentors click Evidence to check the work.`, href: `/log?task=${noEvidence[0]}`, tone: "aqua" });
  }

  const row = (t: (typeof open)[number]): FocusTask => ({
    gid: t.gid,
    name: t.name,
    url: t.url,
    project: projectDef(t.project).title,
    dueOn: t.dueOn,
    stage: t.stage,
    hours: t.hours,
  });
  const groups: FocusGroup[] = [
    { title: "Overdue", overdue: true, tasks: buckets.overdue.map(row) },
    { title: "Due today", tasks: buckets.dueToday.map(row) },
    { title: "In progress", tasks: buckets.inProgress.map(row) },
    { title: "Blocked", tasks: buckets.blocked.map(row) },
  ];
  const hasFocus = groups.some((g) => g.tasks.length);
  const firstRun = open.length === 0 && finishedCount === 0 && perProject.every((p) => p.open.ok);
  // What comes next in each project, not the first few from one of them.
  const nextUp = perProject
    .flatMap((p) => {
      const next = (p.open.ok ? p.open.value : [])
        .filter((t) => (!t.dueOn || t.dueOn > date) && t.stage === "Not started" && !findUnit(t.ref)?.unit.optional)
        .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"))[0];
      return next ? [next] : [];
    })
    .map(row);

  const heading = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={heading} title="Today" />

      <YourDay
        date={date}
        now={now}
        day={yourDay(date, schedule.ok ? schedule.value.blocks : null, life.state ?? null, now)}
        error={schedule.ok ? undefined : `The schedule could not be read: ${schedule.error}`}
      />

      {totals && !firstRun && (
        <dl className="card grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label="Today" value={`${formatHours(totals.today)} h`} />
          <div className="space-y-1">
            <dt className="text-xs text-neutral-400">This week</dt>
            <dd className="text-2xl font-bold tabular-nums">
              {formatHours(totals.week)}
              {target ? <span className="text-base font-normal text-neutral-400"> of {target} h</span> : " h"}
            </dd>
            {target && (
              <dd className="h-1.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${Math.round((totals.week / target) * 100)}% of this week's target`}>
                <div className="h-full rounded-full bg-aqua" style={{ width: `${Math.min(100, (totals.week / target) * 100)}%` }} />
              </dd>
            )}
          </div>
          <Stat label="Days studied" value={`${totals.daysStudied} of 7`} />
          <Stat label="Finished this week" value={String(finishedCount)} />
        </dl>
      )}

      {firstRun && <FirstRun native={native} />}

      {hub && overview?.ok && !firstRun && <HubCard hub={hub} roadmap={overview.value.roadmap} today={date} />}

      {!firstRun && (
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="focus-title" className="min-w-0">
            <SectionTitle action={<Link href="/log" className="text-sm text-neutral-400 hover:text-white">Log a session</Link>}>
              <span id="focus-title">Focus</span>
            </SectionTitle>
            {hasFocus ? (
              <FocusList groups={groups} today={date} tomorrow={addDays(date, 1)} canComplete={native} />
            ) : nextUp.length ? (
              <div className="space-y-3">
                <Empty>Nothing is due or in progress. Here is what comes next.</Empty>
                <FocusList groups={[{ title: "Coming up", tasks: nextUp }]} today={date} tomorrow={addDays(date, 1)} canComplete={native} />
              </div>
            ) : (
              <Empty>Everything is done. Add what comes next, or take the rest of the day off.</Empty>
            )}
          </section>

          <div className="space-y-8">
            {attention.length > 0 && (
              <section aria-labelledby="attention-title">
                <SectionTitle><span id="attention-title">Needs attention</span></SectionTitle>
                <ul className="space-y-2">
                  {attention.map((a, i) => (
                    <li key={i}>
                      <AttentionRow item={a} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function FirstRun({ native }: { native: boolean }) {
  return (
    <section className="card-special space-y-4" aria-label="Getting started">
      <h2 className="text-xl font-semibold">Start with your study plan</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-white/90">
        <li>Open Study and load your plans. Each section, chapter and milestone becomes a task, with its steps and exercises.</li>
        <li>Set a pace on the roadmap, then drag the next few onto a time on the Schedule.</li>
        <li>Press Start when you sit down, then Stop and log when you finish.</li>
      </ol>
      {native && (
        <div className="flex flex-wrap gap-2">
          <Link href="/study" className="btn bg-white/15 hover:bg-white/25">Open Study</Link>
          <QuickAddButton className="btn bg-white/15 hover:bg-white/25" />
        </div>
      )}
    </section>
  );
}

const TONES: Record<Attention["tone"], string> = {
  coral: "bg-coral",
  sand: "bg-sand",
  aqua: "bg-aqua",
};

function AttentionRow({ item }: { item: Attention }) {
  const body = (
    <span className="flex items-start gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm ring-1 ring-white/5 transition hover:ring-white/15">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONES[item.tone]}`} aria-hidden />
      <span>{item.text}</span>
    </span>
  );
  return item.href ? <TaskLink href={item.href}>{body}</TaskLink> : body;
}

// ---------------------------------------------------------------------------
// Mentor: their projects
// ---------------------------------------------------------------------------

type StatusResult = Awaited<ReturnType<typeof latestStatus>>;

async function MentorHome({ access }: { access: Access }) {
  const keys = access.projects.filter((k) => projectGid(k));
  const studyKeys = PLANS.map((p) => p.project).filter((k) => keys.includes(k));
  const [statuses, roadmap, jobs] = await Promise.all([
    Promise.all(keys.map(async (k) => ({ key: k, status: await attempt(() => latestStatus(k)), tasks: await attempt(() => allTasks(k)) }))),
    studyKeys.length && !usesAsana()
      ? attempt(async () => {
          const overview = await loadStudy();
          const dueOn = new Map(overview.plans.flatMap((p) => p.rows.map((r) => [r.unit.ref, r.task.dueOn] as const)));
          return shareRoadmap(overview.roadmap, { projects: studyKeys, dueOn, today: overview.today });
        })
      : null,
    access.shares.includes("job-hunt") && !usesAsana()
      ? attempt(async () => {
          const supabase = await createClient();
          const { data, error } = await supabase.rpc("tracker_mentor_job_source");
          if (error) throw new Error(error.message);
          return mentorJobView(data as MentorSource);
        })
      : null,
  ]);
  const date = today();

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={`Hello, ${access.displayName}`} title="Ghassan's progress">
        Each project gets a status update every Sunday. Open a project for tasks, hours and evidence.
      </PageHeader>
      {keys.length === 0 && <Empty>No projects are shared with you yet.</Empty>}
      {(roadmap?.ok || jobs?.ok) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {roadmap?.ok && (
            <Link href="/roadmap" className="card-link space-y-2">
              <p className="eyebrow">Study roadmap</p>
              <p className="text-xl font-semibold">{roadmap.value.current ? `Phase ${roadmap.value.current.index + 1} of 8: ${roadmap.value.current.name}` : "Every phase done"}</p>
              <p className="text-sm text-neutral-300">
                {roadmap.value.done} of {roadmap.value.total} units done.
                {roadmap.value.finishOn ? ` Finish planned for ${shortDate(roadmap.value.finishOn)}.` : ""}
                {roadmap.value.overdue.length ? ` ${roadmap.value.overdue.length} overdue.` : ""}
              </p>
            </Link>
          )}
          {jobs?.ok && (
            <Link href="/job-hunt" className="card-link space-y-2">
              <p className="eyebrow">Job hunt</p>
              <p className="text-xl font-semibold">{jobs.value.inScope} {jobs.value.inScope === 1 ? "role" : "roles"} in scope</p>
              <p className="text-sm text-neutral-300">
                {jobs.value.pipeline.applied} applied, {jobs.value.pipeline.interview} interviewing.
                {jobs.value.gaps[0] ? ` Biggest gap: ${jobs.value.gaps[0].skill.name}, required by ${jobs.value.gaps[0].must}.` : ""}
              </p>
            </Link>
          )}
        </div>
      )}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {statuses.map(({ key, status, tasks }) => (
          <li key={key}>
            <MentorProjectCard
              stats={tasks.ok ? projectStats(tasks.value, date) : null}
              projectKey={key}
              status={status.ok ? status.value : null}
              error={status.ok ? null : status.error}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MentorProjectCard({
  stats,
  projectKey,
  status,
  error,
}: {
  stats: ReturnType<typeof projectStats> | null;
  projectKey: ProjectKey;
  status: StatusResult;
  error: string | null;
}) {
  const def = projectDef(projectKey);
  return (
    <Link href={`/progress/${projectKey}`} className="card-link h-full space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{def.area}</p>
          <p className="text-xl font-semibold">{def.title}</p>
        </div>
        {status && <StatusPill status={status.status_type} />}
      </div>
      {stats && stats.total > 0 && (
        <p className="text-sm text-neutral-300">
          {stats.percent}% done, {stats.done} of {stats.total} tasks, <Hours value={stats.hours} /> logged
        </p>
      )}
      {error ? (
        <ErrorNote message={error} />
      ) : status ? (
        <>
          <p className="text-xs text-neutral-400">
            Latest update, {new Date(status.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </p>
          <p className="line-clamp-5 text-sm whitespace-pre-line text-neutral-300">{status.text}</p>
        </>
      ) : (
        <p className="text-sm text-neutral-400">{def.blurb} No status update yet.</p>
      )}
    </Link>
  );
}
