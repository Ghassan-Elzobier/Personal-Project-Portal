import "server-only";
import { projectGid, timeZone } from "../config/env";
import { LIFE_KINDS, REPEATS } from "../calendar/life-blocks";
import * as ops from "../portal/operations";
import { attempt, bucketForToday, openTasks, thisWeek, today, weekSummary, type TaskView } from "../portal/data";
import { isProjectKey, PROJECTS, projectDef, type ProjectKey } from "../config/projects";
import { loadScheduleWeek, resolveWeek, type Block } from "../portal/schedule";
import { STAGES, STATUS_TYPES } from "../tasks/session-log";
import { clock, parseClock, weekdayIndex } from "../dates/week";
import { METRICS } from "../study/benchmarks";
import { studyOverview } from "../study/load";
import { BookError, bookOutline, chaptersOf, cite, readBook, searchBook } from "../library/book";
import { bookHref } from "../library/links";
import { excerptForClaude } from "../library/query";
import { CODE_MAP, PARTS, RENDERER, VIEWS, allFindings, codeLabel, viewById, viewForClaude } from "../lab/guide";
import { achieved, latestResults } from "../lab/results";
import { loadStudy } from "../study/load";
import { LIFE_INSTRUCTIONS, LIFE_TOOLS } from "../life/connector";
import * as lifeOps from "../life/operations";

// The portal's tools as Claude sees them through the connector. Reads run
// freely; every write goes through src/lib/portal/operations.ts, the same code the
// buttons use, and Claude's app asks the owner before running a write tool.

type Json = Record<string, unknown>;

export type ToolResult = { text: string; isError?: boolean };

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Json, ctx: { base: string }) => Promise<ToolResult>;
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Day, YYYY-MM-DD, in the portal's time zone." };
const TIME = { type: "string", pattern: "^\\d{1,2}:\\d{2}$", description: "Start time, 24-hour HH:MM, in the portal's time zone." };
const MINUTES = { type: "integer", minimum: 15, maximum: 720, description: "Length in minutes, a multiple of 5." };
const TASK = { type: "string", pattern: "^\\d+$", description: "Task gid, from get_today, list_tasks or get_week." };
const EVENT = { type: "string", description: "Google Calendar event id of a life block, from get_week." };
const SESSION = { type: "string", description: "event_id of a study session, from get_week or get_today." };
const PROJECT = { type: "string", enum: PROJECTS.map((p) => p.key), description: PROJECTS.map((p) => `${p.key} = ${p.title}`).join("; ") };

/** Task links are relative inside the portal. Claude needs the whole address. */
const fullUrl = (url: string) => (url.startsWith("/") ? `${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""}${url}` : url);

const ok = (value: unknown): ToolResult => ({ text: JSON.stringify(value, null, 1) });
const err = (message: string): ToolResult => ({ text: message, isError: true });
const fromOp = (r: { error?: string }, done: unknown): ToolResult => (r.error ? err(r.error) : ok(done));

function str(args: Json, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function startMinutes(args: Json): number | null {
  return parseClock(str(args, "start"));
}

function task(t: TaskView) {
  return {
    gid: t.gid,
    name: t.name,
    project: t.project,
    section: t.section,
    stage: t.stage,
    due_on: t.dueOn,
    scheduled: t.startAt && t.dueAt ? { start: t.startAt, end: t.dueAt } : null,
    hours_logged: t.hours,
    milestone: t.milestone || undefined,
    url: fullUrl(t.url),
  };
}

function block(b: Block) {
  const base = { day: b.date, start: clock(b.start), end: b.end >= 1440 ? "24:00" : clock(b.end), title: b.title };
  if (b.source === "asana") {
    return { ...base, type: "study", task_gid: b.id.split(":")[0], project: b.project, stage: b.stage, completed: b.completed };
  }
  if (b.source === "session") {
    return { ...base, type: "study_session", task_gid: b.taskGid, event_id: b.id.slice(0, b.id.lastIndexOf(":")), project: b.project, stage: b.stage, completed: b.completed };
  }
  if (b.source === "plan") {
    return { ...base, type: "life_plan", kind: b.kind ?? undefined, moved: b.clash ? undefined : b.note, clash: b.clash ? b.note : undefined, note: "From the Life plan: changes with the meal plan, routine and gym days, not here." };
  }
  return {
    ...base,
    type: b.kind ? "life" : "other_calendar_event",
    event_id: b.kind ? b.id.slice(0, b.id.lastIndexOf(":")) : undefined,
    kind: b.kind ?? undefined,
    repeats: b.seriesId ? true : undefined,
    invite: b.invite,
    note: b.kind ? undefined : "Made outside the portal; read-only here.",
  };
}

function configured(): ProjectKey[] {
  return PROJECTS.filter((p) => projectGid(p.key)).map((p) => p.key);
}

async function openAcross(keys: ProjectKey[]) {
  const results = await Promise.all(keys.map(async (k) => ({ k, r: await attempt(() => openTasks(k)) })));
  const tasks: TaskView[] = [];
  const errors: string[] = [];
  for (const { k, r } of results) {
    if (r.ok) tasks.push(...r.value);
    else errors.push(`${projectDef(k).title}: ${r.error}`);
  }
  return { tasks, errors };
}

export const TOOLS: Tool[] = [
  {
    name: "get_today",
    title: "Today",
    description:
      "Start here. Today's date, time zone and week, links to each portal page, today's planned blocks, and open tasks that are overdue, due today, blocked or in progress.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(_args, { base }) {
      const date = today();
      const week = thisWeek();
      const [{ tasks, errors }, schedule] = await Promise.all([openAcross(configured()), loadScheduleWeek(week)]);
      const b = bucketForToday(tasks, date);
      return ok({
        today: date,
        weekday: WEEKDAYS[weekdayIndex(date)],
        time_zone: timeZone(),
        week: { start: week.start, end: week.end },
        pages: {
          today: `${base}/`,
          schedule: `${base}/schedule`,
          log_a_session: `${base}/log`,
          sunday_update: `${base}/week`,
          timeline: `${base}/timeline`,
          progress: `${base}/progress`,
          mentor_view_of_a_project: `${base}/progress/<project key>`,
          people: `${base}/people`,
        },
        projects: PROJECTS.map((p) => ({ key: p.key, title: p.title, configured: Boolean(projectGid(p.key)) })),
        plan_today: schedule.blocks.filter((x) => x.date === date).map(block),
        hidden_invites_this_week: schedule.hiddenInvites || undefined,
        overdue: b.overdue.map(task),
        due_today: b.dueToday.map(task),
        blocked: b.blocked.map(task),
        in_progress: b.inProgress.map(task),
        google_calendar: typeof schedule.google === "string" ? schedule.google : "error" in schedule.google ? schedule.google.error : "connected",
        errors: [...new Set([...errors, ...schedule.errors])],
      });
    },
  },
  {
    name: "get_week",
    title: "Week schedule",
    description:
      "One week (Monday to Sunday) of the planner: study blocks (a task's own time slot), study sessions (more time on a task), the Life plan's meals, cooking, gym and weigh-in (type life_plan, moved around study and events when they clash), other life blocks from Google Calendar, other calendar events, and open tasks that have no time yet. Invites the owner has not accepted are left out unless asked for. Read this before planning or moving things, to avoid clashes.",
    inputSchema: {
      type: "object",
      properties: {
        week_of: { ...DATE, description: "Any day in the week wanted. Leave out for this week." },
        show_invites: { type: "boolean", description: "True includes invites the owner has not accepted or has declined." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      const week = resolveWeek(str(args, "week_of") || undefined);
      const s = await loadScheduleWeek(week, { showInvites: args.show_invites === true });
      return ok({
        week: { start: s.week.start, end: s.week.end },
        page: `${base}/schedule?week=${s.week.start}`,
        blocks: s.blocks.map(block),
        unscheduled_tasks: s.unscheduled.map((u) => ({ gid: u.gid, name: u.title, project: u.project, due_on: u.dueOn, stage: u.stage })),
        hidden_invites: s.hiddenInvites || undefined,
        google_calendar: typeof s.google === "string" ? s.google : "error" in s.google ? s.google.error : "connected",
        errors: s.errors,
      });
    },
  },
  {
    name: "list_tasks",
    title: "Open tasks",
    description: "Open tasks, all projects or one, with stage, due date, current time slot and hours logged.",
    inputSchema: { type: "object", properties: { project: PROJECT }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(args) {
      const key = str(args, "project");
      if (key && !isProjectKey(key)) return err("Unknown project.");
      const keys = key ? [key as ProjectKey].filter((k) => projectGid(k)) : configured();
      if (!keys.length) return err("That project is not set up in the portal yet.");
      const { tasks, errors } = await openAcross(keys);
      tasks.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
      return ok({ tasks: tasks.map(task), errors });
    },
  },
  {
    name: "create_task",
    title: "Add a task",
    description:
      "Add a task to a project, with an optional due date, section and description. It starts Not started, in the project's first section unless one is named. Use schedule_task afterwards to give it a time slot.",
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT,
        name: { type: "string", minLength: 1, maxLength: 500, description: "What the task is." },
        due_on: { ...DATE, description: "Due day, YYYY-MM-DD, in the portal's time zone." },
        section: { type: "string", description: "Section name within the project. Sections appear on tasks from list_tasks." },
        description: { type: "string", maxLength: 20000, description: "Longer notes on the task." },
        milestone: { type: "boolean", description: "True for a milestone rather than a piece of work." },
      },
      required: ["project", "name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async run(args) {
      const r = await ops.createTask({
        project: str(args, "project"),
        name: str(args, "name"),
        dueOn: str(args, "due_on"),
        sectionName: str(args, "section"),
        notes: str(args, "description"),
        milestone: args.milestone === true,
      });
      return fromOp(r, { created: r.task && { ...r.task, url: fullUrl(r.task.url) } });
    },
  },
  {
    name: "get_study",
    title: "Study progress",
    description:
      "Progress through each study plan: Linear Algebra Done Right (Axler), Programming Massively Parallel Processors (PMPP) and the Vulkan renderer. Gives the current roadmap phase across all three, how the current units connect, what comes next, exercises solved, what is stuck, things due for review, and renderer benchmarks. Read this before helping the owner study.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run() {
      return ok(await studyOverview());
    },
  },
  {
    name: "mark_exercise",
    title: "Mark an exercise",
    description: "Record how an exercise went. Marking one stuck or hint brings it back for review later. Use a null status to clear it.",
    inputSchema: {
      type: "object",
      properties: {
        task_gid: TASK,
        number: { type: "integer", minimum: 1, description: "The exercise's number in that section or chapter." },
        status: { enum: ["solved", "hint", "stuck", "skip", null], description: "solved = on your own; hint = needed help; stuck = could not finish; skip = chose not to do it." },
      },
      required: ["task_gid", "number", "status"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args) {
      const status = args.status === null ? null : str(args, "status");
      return fromOp(await ops.setExercise(str(args, "task_gid"), Number(args.number), status as never), { saved: true });
    },
  },
  {
    name: "rate_review",
    title: "Rate a review",
    description: "Record how recalling something went after the owner tried it from memory. got spaces it further out, shaky repeats the gap, missed starts it again tomorrow. review_gid comes from get_study.",
    inputSchema: {
      type: "object",
      properties: { review_gid: { type: "string", pattern: "^\\d+$" }, rating: { enum: ["got", "shaky", "missed"] } },
      required: ["review_gid", "rating"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async run(args) {
      return fromOp(await ops.rateReview(str(args, "review_gid"), str(args, "rating")), { saved: true });
    },
  },
  {
    name: "add_benchmark",
    title: "Record a renderer result",
    description: "Record a measured result for the renderer, tied to a commit and GPU. Only results with the same metric, scene and GPU are compared.",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", description: `What was measured. Known ones: ${METRICS.map((m) => m.name).join(", ")}.` },
        value: { type: "number" },
        unit: { type: "string" },
        scene: { type: "string" },
        gpu: { type: "string" },
        commit: { type: "string", description: "Commit hash, 7 to 40 characters." },
        notes: { type: "string" },
      },
      required: ["metric", "value"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async run(args) {
      const r = await ops.addBenchmark({ project: "rendering", metric: str(args, "metric"), value: Number(args.value), unit: str(args, "unit"), scene: str(args, "scene"), gpu: str(args, "gpu"), commit: str(args, "commit"), notes: str(args, "notes") });
      return fromOp(r, { saved: true });
    },
  },
  {
    name: "schedule_task",
    title: "Schedule a task",
    description:
      "Put a task in a time slot (sets its start and due time) and mirror it to Google Calendar. Also moves a task that already has a slot. The slot ends when the task is due, so use it for the last session on a task and add_study_session for the ones before. Mentors see these times on the timeline.",
    inputSchema: {
      type: "object",
      properties: { task_gid: TASK, date: DATE, start: TIME, minutes: MINUTES },
      required: ["task_gid", "date", "start", "minutes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args) {
      const start = startMinutes(args);
      if (start === null) return err("start must be HH:MM.");
      const r = await ops.scheduleTask({ gid: str(args, "task_gid"), date: str(args, "date"), start, duration: Number(args.minutes) });
      return fromOp(r, { scheduled: r.task, date: str(args, "date"), start: clock(start), end: clock(start + Number(args.minutes)), warning: r.warning });
    },
  },
  {
    name: "add_study_session",
    title: "Add a study session",
    description:
      "Add one more block of study time on a task, for work spread over several days. Sessions go to Google Calendar and show on the Schedule; they do not change the task's due date. Mentors do not see them.",
    inputSchema: {
      type: "object",
      properties: { task_gid: TASK, date: DATE, start: TIME, minutes: MINUTES },
      required: ["task_gid", "date", "start", "minutes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async run(args) {
      const start = startMinutes(args);
      if (start === null) return err("start must be HH:MM.");
      const r = await ops.addStudySession({ gid: str(args, "task_gid"), date: str(args, "date"), start, duration: Number(args.minutes) });
      return fromOp(r, { added: r.task, date: str(args, "date"), start: clock(start), end: clock(start + Number(args.minutes)) });
    },
  },
  {
    name: "move_study_session",
    title: "Move a study session",
    description: "Move or resize one study session. Use schedule_task to move a task's own slot.",
    inputSchema: {
      type: "object",
      properties: { event_id: SESSION, date: DATE, start: TIME, minutes: MINUTES },
      required: ["event_id", "date", "start", "minutes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(args) {
      const start = startMinutes(args);
      if (start === null) return err("start must be HH:MM.");
      const r = await ops.moveLifeBlockTo({ id: str(args, "event_id"), date: str(args, "date"), start, duration: Number(args.minutes) });
      return fromOp(r, { moved: true, date: str(args, "date"), start: clock(start) });
    },
  },
  {
    name: "remove_study_session",
    title: "Delete a study session",
    description: "Delete one study session. The task and its own slot stay as they are.",
    inputSchema: {
      type: "object",
      properties: { event_id: SESSION },
      required: ["event_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async run(args) {
      return fromOp(await ops.removeLifeBlock({ id: str(args, "event_id"), wholeSeries: false }), { deleted: true });
    },
  },
  {
    name: "sync_study_calendar",
    title: "Sync study to Google Calendar",
    description: "Copy every open task's time slot to Google Calendar. Safe to run again: each task keeps one event. Needed once for slots made before mirroring existed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run() {
      const r = await ops.syncStudyCalendar();
      return fromOp(r, { synced: r.synced, failed: r.failed });
    },
  },
  {
    name: "sync_life_calendar",
    title: "Update Life in Google Calendar",
    description:
      "Bring the Google Calendar copy of the Life plan (meals, cooking, gym and weigh-in for the next two weeks) up to date. It updates by itself after every change; use this when Google was offline.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run() {
      const r = await lifeOps.syncLifeCalendar();
      return r.error !== undefined ? err(r.error) : ok({ written: r.written, removed: r.removed, partial: r.partial || undefined });
    },
  },
  {
    name: "unschedule_task",
    title: "Take a task off the grid",
    description: "Remove a task's time slot. It stays due on the given day.",
    inputSchema: {
      type: "object",
      properties: { task_gid: TASK, due_on: { ...DATE, description: "Day the task stays due." } },
      required: ["task_gid", "due_on"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(args) {
      return fromOp(await ops.unscheduleTask({ gid: str(args, "task_gid"), date: str(args, "due_on") }), { unscheduled: true, due_on: str(args, "due_on") });
    },
  },
  {
    name: "add_life_block",
    title: "Add a life block",
    description:
      "Add lunch, cooking, cleaning, gym, rest or another personal block to Google Calendar. These never go on tasks, so mentors never see them. Can repeat.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: Object.keys(LIFE_KINDS) },
        title: { type: "string", maxLength: 120, description: "Optional. Defaults to the kind, such as Lunch." },
        date: { ...DATE, description: "Day of the block, or of the first one when it repeats." },
        start: TIME,
        minutes: MINUTES,
        repeat: {
          type: "string",
          enum: Object.keys(REPEATS),
          description: Object.entries(REPEATS).map(([k, v]) => `${k} = ${v}`).join("; "),
        },
      },
      required: ["kind", "date", "start", "minutes", "repeat"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async run(args) {
      const start = startMinutes(args);
      if (start === null) return err("start must be HH:MM.");
      const input = { kind: str(args, "kind"), title: str(args, "title"), date: str(args, "date"), start, duration: Number(args.minutes), repeat: str(args, "repeat") || "none" };
      return fromOp(await ops.addLifeBlock(input), { added: input.title || input.kind, date: input.date, start: clock(start), repeat: input.repeat });
    },
  },
  {
    name: "move_life_block",
    title: "Move a life block",
    description: "Move or resize one occurrence of a life block the portal made. Use schedule_task for a task's slot and move_study_session for study sessions.",
    inputSchema: {
      type: "object",
      properties: { event_id: EVENT, date: DATE, start: TIME, minutes: MINUTES },
      required: ["event_id", "date", "start", "minutes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(args) {
      const start = startMinutes(args);
      if (start === null) return err("start must be HH:MM.");
      const r = await ops.moveLifeBlockTo({ id: str(args, "event_id"), date: str(args, "date"), start, duration: Number(args.minutes) });
      return fromOp(r, { moved: true, date: str(args, "date"), start: clock(start) });
    },
  },
  {
    name: "remove_life_block",
    title: "Delete a life block",
    description: "Delete one occurrence of a life block the portal made, or its whole repeating series.",
    inputSchema: {
      type: "object",
      properties: { event_id: EVENT, whole_series: { type: "boolean", description: "True deletes every repeat." } },
      required: ["event_id", "whole_series"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async run(args) {
      return fromOp(await ops.removeLifeBlock({ id: str(args, "event_id"), wholeSeries: args.whole_series === true }), { deleted: true });
    },
  },
  {
    name: "log_session",
    title: "Log a study session",
    description:
      "Log time spent on a task: adds hours to its Hours field, optionally sets Stage and an Evidence link, and posts a session comment that mentors read. Stage Done completes the task.",
    inputSchema: {
      type: "object",
      properties: {
        task_gid: TASK,
        hours: { type: "number", minimum: 0.25, maximum: 16, description: "In quarters: 0.25, 1.5, 2." },
        stage: { type: "string", enum: [...STAGES], description: "Leave out to keep the current stage." },
        evidence: { type: "string", description: "Optional https link: a commit, notes, a solution." },
        notes: { type: "string", maxLength: 4000, description: "What was done, in the owner's words." },
      },
      required: ["task_gid", "hours"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    async run(args) {
      const r = await ops.logSession(str(args, "task_gid"), { hours: args.hours, stage: args.stage, evidence: args.evidence, notes: args.notes });
      return r.error ? err(r.error) : ok({ logged: r.ok && { ...r.ok, url: fullUrl(r.ok.url) } });
    },
  },
  {
    name: "draft_weekly_update",
    title: "Draft a Sunday update",
    description:
      "This week's numbers for one project (hours, finished, next, blocked), a draft status update in the template mentors expect, and whether one is already posted. Show the draft to the owner before posting.",
    inputSchema: { type: "object", properties: { project: PROJECT }, required: ["project"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      const key = str(args, "project");
      if (!isProjectKey(key) || !projectGid(key)) return err("Unknown or unconfigured project.");
      const week = thisWeek();
      let studyHours: number | undefined;
      if (key === "weekly-log") {
        const others = await Promise.all(configured().filter((k) => k !== "weekly-log").map((k) => attempt(() => weekSummary(k, week))));
        studyHours = Math.round(others.reduce((sum, s) => sum + (s.ok ? s.value.hours : 0), 0) * 100) / 100;
      }
      const s = await attempt(() => weekSummary(key, week, { studyHours }));
      if (!s.ok) return err(s.error);
      return ok({
        project: projectDef(key).title,
        week: { start: week.start, end: week.end },
        hours: s.value.hours,
        finished: s.value.done.map((t) => t.name),
        next: s.value.next.map((t) => t.name),
        blocked_or_in_review: s.value.blocked.map((t) => t.name),
        already_posted: s.value.posted ? { status: s.value.posted.status_type, at: s.value.posted.created_at } : null,
        suggested_status: s.value.suggestedStatus,
        draft: s.value.draft,
        page: `${base}/week`,
      });
    },
  },
  {
    name: "post_weekly_update",
    title: "Post a Sunday update",
    description:
      "Post this week's status update to the project, where the mentor for that project reads it. Only post text the owner has seen and agreed to.",
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT,
        status: { type: "string", enum: Object.keys(STATUS_TYPES) },
        text: { type: "string", minLength: 10, maxLength: 10000 },
        post_another: { type: "boolean", description: "True to post even though one is already up this week." },
      },
      required: ["project", "status", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async run(args) {
      const r = await ops.postStatusUpdate({ project: str(args, "project"), status: str(args, "status"), text: String(args.text ?? ""), force: args.post_another === true });
      return fromOp(r, { posted: true });
    },
  },
  {
    name: "search_pmpp",
    title: "Search PMPP",
    description:
      "Search the owner's copy of Programming Massively Parallel Processors (PMPP, 5th edition, Hwu, Kirk and El Hajj) and get the best pages, each with a short excerpt and a citation. The book speaks CUDA. Vulkan and GLSL words (subgroup, workgroup, shared variables, push constant, barrier and so on) are also searched as the CUDA words the book uses, and the reply says which. Pages that match every idea come first, with at most three from any one section. Use a few key words rather than a whole sentence, and run several small searches rather than one broad one. Follow with read_pmpp to read a page in full. Page numbers are the PDF's own, the same ones get_study uses.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 300, description: "Key words or a short question, e.g. \"warp divergence loop\" or \"subgroup ballot\". Quote a phrase to search it exactly." },
        chapter: { type: "string", pattern: "^([0-9]{1,2}|[A-C])$", description: "Only this chapter: a number such as 4, or an appendix letter A, B or C." },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many pages. Default 6." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      try {
        const r = await searchBook(str(args, "query"), { chapter: str(args, "chapter") || null, limit: Number(args.limit ?? 6) });
        if (!r.groups.length) return err("Every word in that query is too common to search. Use the idea itself, such as \"coalescing\" or \"occupancy\".");
        return ok({
          query: r.query,
          also_searched: r.translated.map((t) => ({ for: t.from, book_words: t.to })),
          note: r.results.length && r.matchedEvery < r.results.length ? `${r.matchedEvery} of ${r.results.length} pages match every term; the rest match some.` : undefined,
          results: r.results.map((h) => ({
            cite: cite(h),
            page: h.page,
            section: h.section,
            where: h.heading,
            kind: h.kind === "figure" ? "describes a figure in words" : h.kind === "front" ? "front matter" : undefined,
            excerpt: excerptForClaude(h.excerpt),
            read: `${base}${bookHref.page(h.page)}`,
            pdf: `${base}${bookHref.pdf(h.page)}`,
          })),
        });
      } catch (e) {
        if (e instanceof BookError && e.status === 403) return err("Only the owner can search the book.");
        throw e;
      }
    },
  },
  {
    name: "read_pmpp",
    title: "Read PMPP",
    description:
      "Read the owner's PMPP in full: up to 6 pages from a page number, or from the start of a section such as 6.1 or a chapter such as 6. With neither, returns the table of contents: every chapter and section with its first page. Pages at the end of each chapter describe its figures in words; the figures themselves are only in the PDF, so give the owner the pdf link when a figure matters. Quote only the sentences you need and give their page.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, maximum: 5000, description: "First page to read, the PDF's own number, from search_pmpp or get_study." },
        section: { type: "string", pattern: "^([0-9]{1,2}|[A-C])(\\.[0-9]{1,2})?$", description: "A section such as 4.5, or a chapter such as 4. Reads from its first page." },
        pages: { type: "integer", minimum: 1, maximum: 6, description: "How many pages. Default 3." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      const page = typeof args.page === "number" ? args.page : undefined;
      const section = str(args, "section") || undefined;
      try {
        if (!page && !section) {
          const outline = await bookOutline();
          if (!outline.pages) return err("The book is not loaded yet. The owner loads it once with npm run load:book from the portal's folder.");
          return ok({
            pages: outline.pages,
            chapters: chaptersOf(outline).map((c) => ({ chapter: c.chapter, title: c.title, first_page: c.first_page, sections: c.sections.map((s) => `${s.number} ${s.title}, p. ${s.first_page}`) })),
          });
        }
        const r = await readBook({ page, section, count: Number(args.pages ?? 3) });
        if (!r.pages.length) return err(`There is no page ${page ?? ""} in the loaded book.${r.last_page ? ` It ends at page ${r.last_page}.` : ""}`);
        return ok({
          section: r.section ? `${r.section.number} ${r.section.title}, pages ${r.section.first_page} to ${r.section.last_page}` : undefined,
          pages: r.pages.map((p) => ({ cite: cite(p), page: p.page, kind: p.kind === "figure" ? "describes a figure in words" : undefined, text: p.text })),
          next_page: r.next_page,
          pdf: `${base}${bookHref.pdf(r.pages[0].page)}`,
        });
      } catch (e) {
        if (e instanceof BookError && (e.status === 404 || e.status === 400)) return err(`${e.message} Call read_pmpp with no arguments for the contents.`);
        if (e instanceof BookError && e.status === 403) return err("Only the owner can read the book.");
        throw e;
      }
    },
  },
  {
    name: "explain_renderer",
    title: "How the renderer works",
    description:
      "How the owner's Vulkan path tracer works, from the Lab's diagrams at /lab: what each part of main.cpp and shaders/raytrace.comp does, with links to the lines at a pinned commit, the maths worked through with real pixels' numbers, the PMPP sections that explain it, numbers measured on the owner's Iris Xe or computed from a model of the shader (each labelled), problems found in the code (two bugs confirmed: a synchronization hazard and a red/blue swap through X11), and check-yourself questions with answers. With no view, lists every view by part, every finding, and a map from each range of lines to the views that explain it. Read this before explaining the renderer, so you describe it the way the owner's diagrams draw it.",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string", enum: VIEWS.map((v) => v.id), description: VIEWS.map((v) => `${v.id} = ${v.title}`).join("; ") } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      const id = str(args, "view");
      // The owner's recorded results on each GPU, so explanations use real numbers.
      const study = await attempt(() => loadStudy());
      const latest = latestResults(study.ok ? study.value.study.benchmarks.filter((b) => b.project === "rendering") : []);
      const recorded = (["iris", "rx"] as const).map((g) => {
        const r = latest[g];
        const a = r.dispatch ? achieved(r.dispatch.ms) : null;
        return {
          gpu: r.name,
          dispatch_ms: r.dispatch?.ms ?? null,
          commit: r.dispatch?.commit ?? null,
          achieved: a ? { gflops: Math.round(a.gflops), gbs: Math.round(a.gbs), mpaths: Math.round(a.mpaths) } : null,
          measured_simd_efficiency: r.divergence ? { subgroup: r.divergence.subgroup, overall_percent: Math.round(r.divergence.overall * 1000) / 10, per_trip_percent: r.divergence.perTrip.map((x) => Math.round(x * 1000) / 10) } : "not measured yet",
        };
      });
      if (id) {
        const v = viewById(id);
        return v ? ok({ ...viewForClaude(v, base), recorded_results: ["memory", "timing", "divergence", "dispatch"].includes(v.id) ? recorded : undefined }) : err(`Unknown view. Use one of: ${VIEWS.map((x) => x.id).join(", ")}.`);
      }
      return ok({
        commit: RENDERER.short,
        page: `${base}/lab`,
        parts: PARTS.map((p) => ({
          part: p.title,
          views: VIEWS.filter((v) => v.part === p.id).map((v) => ({ view: v.id, title: v.title, claim: v.claim, pmpp: v.book.map((b) => `${b.section} ${b.title}, p. ${b.page}`) })),
        })),
        findings: allFindings().map((f) => ({ kind: f.kind, title: f.title, view: f.view })),
        code_map: CODE_MAP.map((c) => `${codeLabel([c.file, c.from, c.to])} ${c.what} → ${c.views.join(", ")}`),
        recorded_results: recorded,
      });
    },
  },
  ...LIFE_TOOLS,
];

export const INSTRUCTIONS = [
  "This is Ghassan's personal project portal: PMPP (CUDA), Axler (linear algebra), the Rendering lab and the Weekly log.",
  "Call get_today first for the date, time zone and current state. Read get_week before planning, and avoid clashes with existing blocks.",
  "Study work is tasks (create_task) with time slots (schedule_task). A task worked on over several days gets its slot on the last day and study sessions (add_study_session) on the days before. Study time is mirrored to Google Calendar. Meals, cooking and the gym come from the Life plan (type life_plan in get_week) and move around study by themselves; change them through the Life tools, not add_life_block. Other personal time (cleaning, rest) is a life block in Google Calendar only (add_life_block).",
  "Mentors see task times, session comments and status updates. Keep personal life out of tasks.",
  "For studying, call get_study first. Work from the current roadmap phase, and bring up its connections between the plans when they help. Follow the plan's method: have the owner try from memory or attempt an exercise before you explain. Hints before answers.",
  "When a request needs several changes, say the plan in one short list, then make the changes. Link the portal page that shows the result.",
  "For GPU questions, look in the owner's PMPP: search_pmpp with a few key words, then read_pmpp for the pages that matter. Cite section and page (\"PMPP 4.5, p. 225\"), explain in your own words and quote only a sentence or two. Vulkan words are translated to the book's CUDA words for you.",
  "For the renderer, call explain_renderer first; the owner sees the same diagrams at /lab. Each view has check-yourself questions: ask one and let the owner predict before you explain.",
  LIFE_INSTRUCTIONS,
].join(" ");
