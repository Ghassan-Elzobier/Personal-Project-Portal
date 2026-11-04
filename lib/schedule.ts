import "server-only";
import { projectGid, timeZone } from "./env";
import { googleConfigured, googleConnection, listEvents } from "./google";
import { attempt, openTasks, toView, type TaskView } from "./portal-data";
import { listTasks } from "./asana";
import { PROJECTS, projectDef } from "./projects";
import { addDays, weekOf, zonedParts, type Week } from "./week";
import { midnightIn } from "./week";

// One week of schedule: Asana tasks with times (work) and Google Calendar
// events (life), flattened into blocks the grid can place.

export type Block = {
  id: string;
  source: "asana" | "google";
  title: string;
  date: string;
  /** Minutes after midnight in the portal's time zone. */
  start: number;
  end: number;
  url: string;
  editable: boolean;
  /** Asana: the project title. Google: the life kind, or null for other events. */
  project?: string;
  stage?: string | null;
  kind?: string | null;
  seriesId?: string | null;
  completed?: boolean;
};

export type Unscheduled = {
  gid: string;
  title: string;
  project: string;
  dueOn: string | null;
  stage: string | null;
};

export type GoogleState = "not-configured" | "not-connected" | { email: string | null } | { error: string };

export type ScheduleWeek = {
  week: Week;
  days: string[];
  blocks: Block[];
  unscheduled: Unscheduled[];
  errors: string[];
  google: GoogleState;
};

/** Week containing ?week=YYYY-MM-DD, or this week. */
export function resolveWeek(param: string | undefined): Week {
  const tz = timeZone();
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && !Number.isNaN(Date.parse(`${param}T12:00:00Z`))) {
    return weekOf(new Date(midnightIn(param, tz).getTime() + 12 * 3600 * 1000), tz);
  }
  return weekOf(new Date(), tz);
}

/** Splits a span into per-day pieces so a block past midnight shows on both days. */
function place(start: Date, end: Date, tz: string): { date: string; start: number; end: number }[] {
  const a = zonedParts(start, tz);
  const b = zonedParts(end, tz);
  if (a.date === b.date) return [{ date: a.date, start: a.minutes, end: Math.max(b.minutes, a.minutes + 15) }];
  const pieces = [{ date: a.date, start: a.minutes, end: 24 * 60 }];
  if (b.minutes > 0) pieces.push({ date: b.date, start: 0, end: b.minutes });
  return pieces;
}

export function workBlocks(tasks: TaskView[], tz: string): Block[] {
  const blocks: Block[] = [];
  for (const t of tasks) {
    if (!t.dueAt) continue;
    const end = new Date(t.dueAt);
    // A due time with no start shows as the hour before it.
    const start = t.startAt ? new Date(t.startAt) : new Date(end.getTime() - 60 * 60 * 1000);
    for (const piece of place(start, end, tz)) {
      blocks.push({
        id: `${t.gid}:${piece.date}`,
        source: "asana",
        title: t.name,
        ...piece,
        url: t.url,
        editable: !t.completed,
        project: projectDef(t.project).title,
        stage: t.stage,
        completed: t.completed,
      });
    }
  }
  return blocks;
}

export async function loadScheduleWeek(week: Week): Promise<ScheduleWeek> {
  const tz = timeZone();
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.start, i));
  const configured = PROJECTS.filter((p) => projectGid(p.key));
  const errors: string[] = [];

  // Open tasks, plus tasks finished this week so done sessions stay on the grid.
  const perProject = await Promise.all(
    configured.map(async (p) => ({
      p,
      result: await attempt(async () => {
        const [open, recent] = await Promise.all([
          openTasks(p.key),
          listTasks(p.key, { completedSince: week.startsAt }),
        ]);
        const done = recent.filter((t) => t.completed).map((t) => toView(t, p.key));
        return [...open, ...done];
      }),
    })),
  );
  const tasks: TaskView[] = [];
  for (const { p, result } of perProject) {
    if (result.ok) tasks.push(...result.value);
    else errors.push(`${p.title}: ${result.error}`);
  }

  const inWeek = (b: Block) => b.date >= week.start && b.date <= week.end;
  const blocks = workBlocks(tasks, tz).filter(inWeek);

  const unscheduled: Unscheduled[] = tasks
    .filter((t) => !t.completed && !t.dueAt && !t.milestone)
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"))
    .map((t) => ({ gid: t.gid, title: t.name, project: projectDef(t.project).title, dueOn: t.dueOn, stage: t.stage }));

  let google: GoogleState;
  if (!googleConfigured()) {
    google = "not-configured";
  } else {
    const connection = await googleConnection();
    if (!connection) {
      google = "not-connected";
    } else {
      try {
        const events = await listEvents(week.startsAt, week.endsAt);
        for (const e of events) {
          for (const piece of place(new Date(e.start), new Date(e.end), tz)) {
            const block: Block = {
              id: `${e.id}:${piece.date}`,
              source: "google",
              title: e.title,
              ...piece,
              url: e.url,
              editable: e.kind !== null,
              kind: e.kind,
              seriesId: e.seriesId,
            };
            if (inWeek(block)) blocks.push(block);
          }
        }
        google = { email: connection.email };
      } catch (err) {
        google = { error: err instanceof Error ? err.message : "Could not read Google Calendar." };
      }
    }
  }

  blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { week, days, blocks, unscheduled, errors, google };
}
