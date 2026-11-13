import "server-only";
import {
  AsanaError,
  field,
  listSessionComments,
  listStatusUpdates,
  listTasks,
  type AsanaStatusUpdate,
  type AsanaTask,
} from "../tasks/tracker";
import { projectGid, timeZone, usesAsana, weeklyHoursTarget } from "../config/env";
import { studySnapshot } from "../tasks/native";
import { projectDef, type ProjectKey } from "../config/projects";
import { sessionHours, statusDraft, type StatusType } from "../tasks/session-log";
import { addDays, dateIn, weekOf, type Week } from "../dates/week";
import { now } from "@/lib/dates/clock";

// What the pages show, shaped from the task backend. Every loader returns a result
// rather than throwing, so one broken project never blanks the whole page.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const message =
      err instanceof AsanaError ? err.message : "Something went wrong reading your tasks. Try again in a minute.";
    if (!(err instanceof AsanaError)) console.error(err);
    return { ok: false, error: message };
  }
}

export type TaskView = {
  gid: string;
  name: string;
  project: ProjectKey;
  section: string | null;
  sectionGid: string | null;
  notes: string;
  ref: string | null;
  exerciseCount: number | null;
  completed: boolean;
  completedAt: string | null;
  dueOn: string | null;
  dueAt: string | null;
  startOn: string | null;
  startAt: string | null;
  milestone: boolean;
  url: string;
  stage: string | null;
  phase: string | null;
  type: string | null;
  hours: number;
  evidence: string | null;
  stageOptions: string[];
};

export function toView(task: AsanaTask, project: ProjectKey): TaskView {
  const gid = projectGid(project);
  const membership = task.memberships?.find((m) => m.project.gid === gid);
  const stage = field(task, "Stage");
  const evidence = field(task, "Evidence")?.text_value?.trim() || null;
  return {
    gid: task.gid,
    name: task.name,
    project,
    section: membership?.section?.name ?? null,
    sectionGid: membership?.section?.gid ?? null,
    notes: task.notes ?? "",
    ref: task.ref ?? null,
    exerciseCount: task.exerciseCount ?? null,
    completed: task.completed,
    completedAt: task.completed_at,
    dueOn: task.due_on ?? (task.due_at ? dateIn(new Date(task.due_at), timeZone()) : null),
    dueAt: task.due_at ?? null,
    startOn: task.start_on ?? (task.start_at ? dateIn(new Date(task.start_at), timeZone()) : null),
    startAt: task.start_at ?? null,
    milestone: task.resource_subtype === "milestone",
    url: task.permalink_url,
    stage: stage?.enum_value?.name ?? null,
    phase: field(task, "Phase")?.display_value ?? null,
    type: field(task, "Type")?.display_value ?? null,
    hours: field(task, "Hours")?.number_value ?? 0,
    evidence: evidence && /^https?:\/\//.test(evidence) ? evidence : null,
    stageOptions: stage?.enum_options?.filter((o) => o.enabled !== false).map((o) => o.name) ?? [],
  };
}

export function today(): string {
  return dateIn(now(), timeZone());
}

export function thisWeek(): Week {
  return weekOf(now(), timeZone());
}

/** Open tasks in a project. */
export async function openTasks(key: ProjectKey): Promise<TaskView[]> {
  const tasks = await listTasks(key, { completedSince: "now" });
  return tasks.filter((t) => !t.completed).map((t) => toView(t, key));
}

/** Every task in a project, open and done. */
export async function allTasks(key: ProjectKey): Promise<TaskView[]> {
  const tasks = await listTasks(key);
  return tasks.map((t) => toView(t, key));
}

export type TodayBuckets = {
  overdue: TaskView[];
  dueToday: TaskView[];
  blocked: TaskView[];
  inProgress: TaskView[];
};

/** Splits open tasks into what needs doing today. A task lands in one bucket. */
export function bucketForToday(tasks: TaskView[], date: string): TodayBuckets {
  const buckets: TodayBuckets = { overdue: [], dueToday: [], blocked: [], inProgress: [] };
  for (const t of tasks) {
    if (t.dueOn && t.dueOn < date) buckets.overdue.push(t);
    else if (t.dueOn === date) buckets.dueToday.push(t);
    else if (t.stage === "Blocked") buckets.blocked.push(t);
    else if (t.stage === "In progress" || t.stage === "Needs review") buckets.inProgress.push(t);
  }
  const byDue = (a: TaskView, b: TaskView) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999");
  buckets.overdue.sort(byDue);
  return buckets;
}

export type WeekSummary = {
  key: ProjectKey;
  week: Week;
  hours: number;
  done: TaskView[];
  hoursByTask: Map<string, number>;
  next: TaskView[];
  blocked: TaskView[];
  posted: AsanaStatusUpdate | null;
  draft: string;
  suggestedStatus: StatusType;
};

/**
 * One project's week: hours from session comments, tasks finished, what is
 * next, what is stuck, whether the update is posted, and a draft of it.
 */
export async function weekSummary(
  key: ProjectKey,
  week: Week = thisWeek(),
  options: { studyHours?: number } = {},
): Promise<WeekSummary> {
  const [touched, open, updates, comments] = await Promise.all([
    listTasks(key, { modifiedSince: week.startsAt }),
    openTasks(key),
    listStatusUpdates(key, week.startsAt),
    listSessionComments(week.startsAt, key),
  ]);

  const inWeek = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= week.startsAt.getTime() && t < week.endsAt.getTime();
  };

  const hoursByTask = new Map<string, number>();
  for (const c of comments.filter((c) => inWeek(c.createdAt))) {
    const logged = sessionHours(c.text) ?? 0;
    if (logged > 0) hoursByTask.set(c.taskGid, Math.round(((hoursByTask.get(c.taskGid) ?? 0) + logged) * 100) / 100);
  }
  const hours = Math.round([...hoursByTask.values()].reduce((a, b) => a + b, 0) * 100) / 100;

  const done = touched
    .filter((t) => t.completed && t.completed_at && inWeek(t.completed_at))
    .map((t) => toView(t, key));

  const nextWeekEnd = addDays(week.end, 7);
  const next = open
    .filter((t) => t.stage !== "Blocked" && t.stage !== "Needs review")
    .filter((t) => t.stage === "In progress" || (t.dueOn !== null && t.dueOn <= nextWeekEnd))
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"))
    .slice(0, 5);
  const blocked = open.filter((t) => t.stage === "Blocked" || t.stage === "Needs review");
  const overdue = open.filter((t) => t.dueOn !== null && t.dueOn < today());

  const suggestedStatus: StatusType =
    overdue.length > 2 ? "off_track" : blocked.length > 0 || overdue.length > 0 ? "at_risk" : "on_track";

  const target = weeklyHoursTarget();
  const draft = statusDraft({
    practice: usesAsana() ? null : await weekPractice(key, week, inWeek),
    status: suggestedStatus,
    done: done.map((t) => ({ name: t.name, hours: hoursByTask.get(t.gid) ?? 0, evidence: t.evidence })),
    next: next.map((t) => t.name),
    blocked: blocked.map((t) => `${t.name} (${t.stage?.toLowerCase()})`),
    // The weekly log reports all study hours against the weekly target.
    hours: options.studyHours ?? hours,
    target: options.studyHours !== undefined ? target : null,
  });

  return {
    key,
    week,
    hours,
    done,
    hoursByTask,
    next,
    blocked,
    posted: updates[0] ?? null,
    draft,
    suggestedStatus,
  };
}

/** Exercises solved and things recalled this week, for the status update. */
async function weekPractice(key: ProjectKey, week: Week, inWeek: (iso: string) => boolean): Promise<string | null> {
  const [study, tasks] = await Promise.all([studySnapshot(), listTasks(key)]);
  const gids = new Set(tasks.map((t) => t.gid));
  const solved = study.exercises.filter((e) => gids.has(e.task_gid) && e.status === "solved" && inWeek(e.updated_at)).length;
  const reviewed = study.reviews.filter((r) => gids.has(r.task_gid) && r.last_reviewed_at && inWeek(r.last_reviewed_at)).length;
  if (!solved && !reviewed) return null;
  const parts = [];
  if (solved) parts.push(`${solved} ${solved === 1 ? "exercise" : "exercises"} solved`);
  if (reviewed) parts.push(`${reviewed} recalled from memory`);
  return `${parts.join(", ")}.`;
}

export async function latestStatus(key: ProjectKey): Promise<AsanaStatusUpdate | null> {
  const updates = await listStatusUpdates(key);
  return updates[0] ?? null;
}

export function projectTitle(key: ProjectKey): string {
  return projectDef(key).title;
}
