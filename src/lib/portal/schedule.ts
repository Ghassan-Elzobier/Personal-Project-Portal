import "server-only";
import { projectGid, timeZone } from "../config/env";
import { googleConfigured, googleConnection, listEvents } from "../calendar/google";
import { attempt, openTasks, toView, type TaskView } from "./data";
import { listTasks } from "../tasks/tracker";
import { isProjectKey, PROJECTS, projectDef } from "../config/projects";
import { isUnanswered, type InviteResponse } from "../calendar/study-events";
import { addDays, weekOf, zonedParts, type Week } from "../dates/week";
import { midnightIn } from "../dates/week";
import type { AgendaItem } from "../life/agenda";
import { loadLife } from "../life/load";
import { lifeBlocks } from "./life-plan";
import { now } from "@/lib/dates/clock";

// One week of schedule: tasks with times (work), extra study sessions, Google
// Calendar events, and the Life plan (meals, cooking, gym and the weigh-in, read
// from the meal plan and the gym rotation), flattened into blocks the grid can
// place. The Life items are arranged around everything else, so a clash moves
// the meal and not the meeting. A task's slot and the Life items are also copied
// to Google Calendar; those copies are skipped here so nothing shows twice.

export type Block = {
  id: string;
  /**
   * asana: a task's own slot. session: more study time on a task, kept in Google.
   * google: any other event. plan: from the Life plan, changed in Life.
   */
  source: "asana" | "session" | "google" | "plan";
  title: string;
  date: string;
  /** Minutes after midnight in the portal's time zone. */
  start: number;
  end: number;
  url: string;
  editable: boolean;
  /** The project title, for study blocks. */
  project?: string;
  /** The task a study block belongs to. */
  taskGid?: string;
  /** Someone else's invite: how it was answered. */
  invite?: InviteResponse;
  stage?: string | null;
  kind?: string | null;
  seriesId?: string | null;
  completed?: boolean;
  /** A Life plan item that moved for a clash, or could not: why. */
  note?: string;
  clash?: boolean;
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
  /** Invites not said yes or maybe to, left off the grid. */
  hiddenInvites: number;
  /** The Life plan's items this week, where they ended up. */
  life: AgendaItem[];
  /** The plan's copies already in Google Calendar, for the sync. */
  mirrors: Mirror[];
};

export type Mirror = { id: string; key: string; title: string; date: string; start: number; end: number };

type LoadedLife = Awaited<ReturnType<typeof loadLife>>;
/** Week containing ?week=YYYY-MM-DD, or this week. */
export function resolveWeek(param: string | undefined): Week {
  const tz = timeZone();
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && !Number.isNaN(Date.parse(`${param}T12:00:00Z`))) {
    return weekOf(new Date(midnightIn(param, tz).getTime() + 12 * 3600 * 1000), tz);
  }
  return weekOf(now(), tz);
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
        taskGid: t.gid,
        stage: t.stage,
        completed: t.completed,
      });
    }
  }
  return blocks;
}

export async function loadScheduleWeek(
  week: Week,
  options: {
    showInvites?: boolean;
    /** The Life state when the caller has it already, so it is read once. null leaves Life out. */
    life?: LoadedLife | Promise<LoadedLife> | null;
  } = {},
): Promise<ScheduleWeek> {
  const tz = timeZone();
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.start, i));
  const configured = PROJECTS.filter((p) => projectGid(p.key));
  const errors: string[] = [];
  // Read alongside the tasks and the calendar, not after them.
  const lifeLoad = options.life === undefined ? loadLife() : Promise.resolve(options.life);

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
  const hidden = new Set<string>();
  const mirrors: Mirror[] = [];
  if (!googleConfigured()) {
    google = "not-configured";
  } else {
    const connection = await googleConnection();
    if (!connection) {
      google = "not-connected";
    } else {
      try {
        const events = await listEvents(week.startsAt, week.endsAt);
        const titles = new Map(tasks.map((t) => [t.gid, t]));
        for (const e of events) {
          // The task's own block already shows its slot, and the Life plan its items.
          if (e.mirror) {
            const a = zonedParts(new Date(e.start), tz);
            const b = zonedParts(new Date(e.end), tz);
            mirrors.push({
              id: e.id,
              key: e.mirror,
              title: e.title,
              date: a.date,
              start: a.minutes,
              end: b.date === a.date ? b.minutes : 24 * 60,
            });
            continue;
          }
          if (e.study?.role === "slot") continue;
          if (!e.study && isUnanswered(e.response) && !options.showInvites) {
            hidden.add(e.id);
            continue;
          }
          const study = e.study;
          const owner = study ? titles.get(study.task) : undefined;
          const projectKey = study?.project && isProjectKey(study.project) ? study.project : owner?.project;
          for (const piece of place(new Date(e.start), new Date(e.end), tz)) {
            const block: Block = study
              ? {
                  id: `${e.id}:${piece.date}`,
                  source: "session",
                  title: owner?.name ?? e.title,
                  ...piece,
                  url: projectKey ? `/tasks?project=${projectKey}&task=${study.task}` : e.url,
                  editable: !owner?.completed,
                  project: projectKey ? projectDef(projectKey).title : undefined,
                  taskGid: study.task,
                  stage: owner?.stage,
                  completed: owner?.completed,
                  seriesId: e.seriesId,
                }
              : {
                  id: `${e.id}:${piece.date}`,
                  source: "google",
                  title: e.title,
                  ...piece,
                  url: e.url,
                  editable: e.kind !== null,
                  kind: e.kind,
                  seriesId: e.seriesId,
                  invite: e.response && e.response !== "accepted" ? e.response : undefined,
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

  const loaded = await lifeLoad;
  let life: AgendaItem[] = [];
  if (loaded?.state) {
    const planned = lifeBlocks(loaded.state, days, blocks, zonedParts(now(), tz));
    blocks.push(...planned.blocks);
    life = planned.items;
  } else if (loaded?.error) {
    errors.push(`Life: ${loaded.error}`);
  }

  blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { week, days, blocks, unscheduled, errors, google, hiddenInvites: hidden.size, life, mirrors };
}
