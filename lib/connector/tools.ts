import "server-only";
import { projectGid, timeZone } from "../env";
import { LIFE_KINDS, REPEATS } from "../life-blocks";
import * as ops from "../operations";
import { attempt, bucketForToday, openTasks, thisWeek, today, weekSummary, type TaskView } from "../portal-data";
import { isProjectKey, PROJECTS, projectDef, type ProjectKey } from "../projects";
import { loadScheduleWeek, resolveWeek, type Block } from "../schedule";
import { STAGES, STATUS_TYPES } from "../session-log";
import { clock, parseClock, weekdayIndex } from "../week";

// The portal's tools as Claude sees them through the connector. Reads run
// freely; every write goes through lib/operations.ts, the same code the
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
const TASK = { type: "string", pattern: "^\\d+$", description: "Asana task gid, from get_today, list_tasks or get_week." };
const EVENT = { type: "string", description: "Google Calendar event id of a life block, from get_week." };
const PROJECT = { type: "string", enum: PROJECTS.map((p) => p.key), description: PROJECTS.map((p) => `${p.key} = ${p.title}`).join("; ") };

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
    url: t.url,
  };
}

function block(b: Block) {
  const base = { day: b.date, start: clock(b.start), end: b.end >= 1440 ? "24:00" : clock(b.end), title: b.title };
  if (b.source === "asana") {
    return { ...base, type: "study", task_gid: b.id.split(":")[0], project: b.project, stage: b.stage, completed: b.completed };
  }
  return {
    ...base,
    type: b.kind ? "life" : "other_calendar_event",
    event_id: b.kind ? b.id.slice(0, b.id.lastIndexOf(":")) : undefined,
    kind: b.kind ?? undefined,
    repeats: b.seriesId ? true : undefined,
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
      "Start here. Today's date, time zone and week, links to each portal page, today's planned blocks, and open Asana tasks that are overdue, due today, blocked or in progress.",
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
      "One week (Monday to Sunday) of the planner: study blocks (Asana tasks with times), life blocks from Google Calendar (lunch, gym and so on), other calendar events, and open tasks that have no time yet. Read this before planning or moving things, to avoid clashes.",
    inputSchema: {
      type: "object",
      properties: { week_of: { ...DATE, description: "Any day in the week wanted. Leave out for this week." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, { base }) {
      const week = resolveWeek(str(args, "week_of") || undefined);
      const s = await loadScheduleWeek(week);
      return ok({
        week: { start: s.week.start, end: s.week.end },
        page: `${base}/schedule?week=${s.week.start}`,
        blocks: s.blocks.map(block),
        unscheduled_tasks: s.unscheduled.map((u) => ({ gid: u.gid, name: u.title, project: u.project, due_on: u.dueOn, stage: u.stage })),
        google_calendar: typeof s.google === "string" ? s.google : "error" in s.google ? s.google.error : "connected",
        errors: s.errors,
      });
    },
  },
  {
    name: "list_tasks",
    title: "Open tasks",
    description: "Open Asana tasks, all projects or one, with stage, due date, current time slot and hours logged.",
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
    name: "schedule_task",
    title: "Schedule a task",
    description:
      "Put an Asana task in a time slot (sets its start and due time in Asana). Also moves a task that already has a slot. Mentors see these times on the timeline.",
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
      return fromOp(r, { scheduled: r.task, date: str(args, "date"), start: clock(start), end: clock(start + Number(args.minutes)) });
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
      "Add lunch, cooking, cleaning, gym, rest or another personal block to Google Calendar. These never go to Asana, so mentors never see them. Can repeat.",
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
    description: "Move or resize one occurrence of a life block the portal made. Use schedule_task for study blocks.",
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
      return r.error ? err(r.error) : ok({ logged: r.ok });
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
      "Post this week's status update to the project in Asana, where the mentor for that project reads it. Only post text the owner has seen and agreed to.",
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
];

export const INSTRUCTIONS = [
  "This is Ghassan's personal project portal over his personal Asana: PMPP (CUDA), Axler (linear algebra), the Rendering lab and the Weekly log.",
  "Call get_today first for the date, time zone and current state. Read get_week before planning, and avoid clashes with existing blocks.",
  "Study work is Asana tasks with time slots (schedule_task). Lunch, cooking, cleaning, gym and rest are life blocks in Google Calendar only (add_life_block).",
  "Mentors see Asana: task times, session comments and status updates. Keep personal life out of Asana.",
  "When a request needs several changes, say the plan in one short list, then make the changes. Link the portal page that shows the result.",
].join(" ");
