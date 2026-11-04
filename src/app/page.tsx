import Link from "next/link";
import { requireAccess, type Access } from "@/lib/auth/access";
import { listStatusUpdates, listTasks } from "@/lib/tasks/tracker";
import { configProblems, projectGid, usesAsana } from "@/lib/config/env";
import { attempt, bucketForToday, latestStatus, openTasks, thisWeek, today, toView, type TaskView } from "@/lib/portal/data";
import { PROJECTS, projectDef, type ProjectKey } from "@/lib/config/projects";
import { loadScheduleWeek, type Block } from "@/lib/portal/schedule";
import { toolsFor } from "@/lib/config/tools";
import { timeZone } from "@/lib/config/env";
import { clock, shortDate, weekdayIndex, zonedParts } from "@/lib/dates/week";
import { DueDate, Empty, ErrorNote, Hours, PageHeader, SectionTitle, StagePill, StatusPill } from "@/components/ui";

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
  const configured = PROJECTS.filter((p) => projectGid(p.key));

  const perProject = await Promise.all(
    configured.map(async (p) => {
      const [open, posted, doneThisWeek] = await Promise.all([
        attempt(() => openTasks(p.key)),
        attempt(async () => (await listStatusUpdates(p.key, week.startsAt)).length > 0),
        attempt(async () =>
          (await listTasks(p.key, { completedSince: week.startsAt }))
            .filter((t) => t.completed && t.completed_at && new Date(t.completed_at) >= week.startsAt)
            .map((t) => toView(t, p.key)),
        ),
      ]);
      return { key: p.key, open, posted, doneThisWeek };
    }),
  );

  const schedule = await attempt(() => loadScheduleWeek(week));
  const agenda = schedule.ok ? schedule.value.blocks.filter((b) => b.date === date) : [];
  const nowMinutes = zonedParts(new Date(), timeZone()).minutes;

  const open = perProject.flatMap((p) => (p.open.ok ? p.open.value : []));
  const buckets = bucketForToday(open, date);

  const attention: Attention[] = [];
  for (const problem of configProblems()) attention.push({ text: problem, tone: "sand" });
  for (const p of perProject) {
    if (!p.open.ok) attention.push({ text: `${projectDef(p.key).title}: ${p.open.error}`, tone: "coral" });
  }
  if (buckets.overdue.length) {
    const n = buckets.overdue.length;
    attention.push({
      text: `${n} overdue ${n === 1 ? "task" : "tasks"}. Reschedule or finish ${n === 1 ? "it" : "them"}.`,
      tone: "coral",
    });
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
  for (const p of perProject) {
    if (!p.doneThisWeek.ok) continue;
    for (const t of p.doneThisWeek.value.filter((t) => !t.evidence)) {
      attention.push({
        text: `Finished "${t.name}" with no Evidence link. Mentors click Evidence to check the work.`,
        href: `/log?task=${t.gid}`,
        tone: "aqua",
      });
    }
  }

  if (schedule.ok && !agenda.some((b) => b.source === "asana") && weekdayIndex(date) < 5 && configured.length) {
    attention.push({ text: "No study time planned today. Drag a task into a slot.", href: "/schedule", tone: "aqua" });
  }

  const focus = [...buckets.overdue, ...buckets.dueToday, ...buckets.inProgress];
  const projectsPosted = perProject.filter((p) => p.posted.ok && p.posted.value).length;
  const statusLine: Record<string, string> = {
    tasks: "Sections, board and full task details.",
    log: focus.length ? `Next up: ${focus[0].name}` : "Pick a task and log it when you finish.",
    week: `${projectsPosted} of ${configured.length} posted for the week of ${shortDate(week.start)}.`,
    progress: `${configured.length} ${configured.length === 1 ? "project" : "projects"} shared with mentors.`,
    people: "Invite mentors and choose what each one sees.",
    schedule: `${agenda.length} ${agenda.length === 1 ? "block" : "blocks"} today${schedule.ok && schedule.value.unscheduled.length ? `, ${schedule.value.unscheduled.length} tasks to plan` : ""}.`,
    timeline: "Phases and milestones across all projects.",
  };
  const heading = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className="space-y-12">
      <PageHeader eyebrow={heading} title="Today">
        Finish a session, then log it. Two minutes keeps your tasks and your mentors up to date.
      </PageHeader>

      <section>
        <SectionTitle>Needs attention</SectionTitle>
        {attention.length ? (
          <ul className="space-y-2">
            {attention.map((a, i) => (
              <li key={i}>
                <AttentionRow item={a} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing needs you right now.</Empty>
        )}
      </section>

      <section>
        <SectionTitle action={<Link href="/schedule" className="text-sm text-neutral-400 hover:text-white">Open schedule</Link>}>
          Today&apos;s plan
        </SectionTitle>
        {agenda.length ? (
          <Agenda blocks={agenda} nowMinutes={nowMinutes} />
        ) : (
          <Empty>Nothing on the schedule today. Plan your sessions on the Schedule page.</Empty>
        )}
      </section>

      <section>
        <SectionTitle
          action={
            <Link href="/log" className="btn-primary">
              Log a session
            </Link>
          }
        >
          Focus
        </SectionTitle>
        {focus.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {focus.map((t) => (
              <li key={t.gid}>
                <FocusCard task={t} date={date} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing is due, overdue or in progress. Add tasks on the Tasks page and give them due dates.</Empty>
        )}
      </section>

      <section>
        <SectionTitle>Tools</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {toolsFor("owner")
            .filter((t) => t.key !== "today" && (t.key !== "tasks" || !usesAsana()))
            .map((tool) => (
              <li key={tool.key}>
                <Link href={tool.href} className="card-link h-full space-y-2">
                  <p className="font-semibold">{tool.title}</p>
                  <p className="text-sm text-neutral-400">{tool.description}</p>
                  <p className="text-xs text-lavender">{statusLine[tool.key]}</p>
                </Link>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

function Agenda({ blocks, nowMinutes }: { blocks: Block[]; nowMinutes: number }) {
  return (
    <ol className="card divide-y divide-white/5 p-0">
      {blocks.map((b) => {
        const past = b.end <= nowMinutes;
        const current = b.start <= nowMinutes && nowMinutes < b.end;
        const gid = b.id.split(":")[0];
        return (
          <li key={b.id} className={`flex items-center gap-4 px-5 py-3 ${current ? "bg-lavender/10" : ""}`}>
            <span className={`w-24 shrink-0 text-sm tabular-nums ${past ? "text-neutral-500" : "text-neutral-300"}`}>
              {clock(b.start)}–{clock(b.end)}
            </span>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${b.source === "asana" ? "bg-lavender" : b.kind ? "bg-mint" : "bg-neutral-500"}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${past ? "text-neutral-400" : ""} ${b.completed ? "line-through" : ""}`}>
                {b.title}
              </span>
              {b.project && <span className="text-xs text-neutral-500">{b.project}</span>}
            </span>
            {current && <span className="chip bg-lavender/20 text-lavender ring-lavender/40">Now</span>}
            {b.source === "asana" && !b.completed && (past || current) && (
              <Link href={`/log?task=${gid}`} className="btn-ghost px-3 py-1 text-xs">
                Log session
              </Link>
            )}
          </li>
        );
      })}
    </ol>
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
  if (!item.href) return body;
  return item.href.startsWith("/") ? (
    <Link href={item.href}>{body}</Link>
  ) : (
    <a href={item.href} target="_blank" rel="noreferrer">
      {body}
    </a>
  );
}

function FocusCard({ task, date }: { task: TaskView; date: string }) {
  return (
    <div className="card flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{projectDef(task.project).title}</p>
          <a href={task.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
            {task.name}
          </a>
        </div>
        <StagePill stage={task.stage} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 text-sm">
        <span className="flex gap-3 text-neutral-400">
          <DueDate dueOn={task.dueOn} today={date} />
          {task.hours > 0 && <Hours value={task.hours} />}
        </span>
        <Link href={`/log?task=${task.gid}`} className="btn-ghost px-4 py-1.5">
          Log session
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mentor: their projects
// ---------------------------------------------------------------------------

type StatusResult = Awaited<ReturnType<typeof latestStatus>>;

async function MentorHome({ access }: { access: Access }) {
  const keys = access.projects.filter((k) => projectGid(k));
  const statuses = await Promise.all(keys.map(async (k) => ({ key: k, status: await attempt(() => latestStatus(k)) })));

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={`Hello, ${access.displayName}`} title="Ghassan's progress">
        Each project gets a status update every Sunday. Open a project for tasks, hours and evidence.
      </PageHeader>
      {keys.length === 0 && <Empty>No projects are shared with you yet.</Empty>}
      <ul className="grid gap-4 md:grid-cols-2">
        {statuses.map(({ key, status }) => (
          <li key={key}>
            <MentorProjectCard
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
  projectKey,
  status,
  error,
}: {
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
      {error ? (
        <ErrorNote message={error} />
      ) : status ? (
        <>
          <p className="text-xs text-neutral-500">
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
