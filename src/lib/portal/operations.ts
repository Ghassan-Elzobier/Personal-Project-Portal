import "server-only";
import { revalidatePath } from "next/cache";
import { addComment, AsanaError, createStatusUpdate, enumOption, field, getTask, listStatusUpdates, projectKeyOfTask, updateTask } from "../tasks/tracker";
import { completionChange, stageChange } from "../tasks/model";
import { timeZone, usesAsana } from "../config/env";
import * as native from "../tasks/native";
import { createLifeBlock, deleteLifeBlock, GoogleError, moveLifeBlock } from "../calendar/google";
import { isLifeKind, parseBlock, REPEATS, type Repeat } from "../calendar/life-blocks";
import { thisWeek, today } from "./data";
import { isProjectKey, type ProjectKey } from "../config/projects";
import { planFor, planPayload, planUnits } from "../study/plans";
import { nextReview, spreadDates, type ExerciseStatus } from "../study/review";
import { addHours, formatHours, parseSessionForm, sessionComment, STAGES, STATUS_TYPES } from "../tasks/session-log";
import { addDays, shortDate, weekdayIndex, zonedInstant } from "../dates/week";

// Every change the portal makes, in one place. The buttons (server actions)
// and the Claude connector both call these after their own owner check, so
// the two can never drift apart in what they allow.

export type OpResult = { error?: string };

function revalidateSchedule() {
  revalidatePath("/schedule");
  revalidatePath("/");
}

function fail(err: unknown, fallback: string): OpResult {
  if (err instanceof AsanaError || err instanceof GoogleError) return { error: err.message };
  console.error(err);
  return { error: fallback };
}

async function ourTask(gid: string) {
  if (!/^\d{1,30}$/.test(gid)) throw new AsanaError("That is not a task id.", 400);
  const task = await getTask(gid);
  if (!(await projectKeyOfTask(task))) throw new AsanaError("That task is not in one of the portal's projects.", 403);
  return task;
}

/** Puts a task in a time slot: sets its start and due time. */
export async function scheduleTask(input: { gid: string; date: string; start: number; duration: number }): Promise<OpResult & { task?: string }> {
  const block = parseBlock(input);
  if (!block.ok) return { error: block.error };
  try {
    const task = await ourTask(input.gid);
    const tz = timeZone();
    const { date, start, duration } = block.value;
    await updateTask(task.gid, {
      start_at: zonedInstant(date, start, tz).toISOString(),
      due_at: zonedInstant(date, start + duration, tz).toISOString(),
    });
    revalidateSchedule();
    return { task: task.name };
  } catch (err) {
    return fail(err, "Could not schedule the task. Check the task.");
  }
}

/** Takes a task off the grid but keeps it due that day. */
export async function unscheduleTask(input: { gid: string; date: string }): Promise<OpResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Pick a day." };
  try {
    const task = await ourTask(input.gid);
    await updateTask(task.gid, { start_at: null, due_on: input.date });
    revalidateSchedule();
    return {};
  } catch (err) {
    return fail(err, "Could not unschedule the task.");
  }
}

export async function addLifeBlock(input: {
  kind: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  repeat: string;
}): Promise<OpResult> {
  const block = parseBlock(input);
  if (!block.ok) return { error: block.error };
  if (!isLifeKind(input.kind)) return { error: "Pick what the block is for." };
  if (!(input.repeat in REPEATS)) return { error: "Pick how often it repeats." };
  const title = input.title.trim().slice(0, 120);
  try {
    await createLifeBlock({
      kind: input.kind,
      title,
      ...block.value,
      repeat: input.repeat as Repeat,
      weekday: weekdayIndex(block.value.date),
    });
    revalidateSchedule();
    return {};
  } catch (err) {
    return fail(err, "Could not add the block to Google Calendar.");
  }
}

export async function moveLifeBlockTo(input: { id: string; date: string; start: number; duration: number }): Promise<OpResult> {
  const block = parseBlock(input);
  if (!block.ok) return { error: block.error };
  try {
    await moveLifeBlock(input.id, block.value.date, block.value.start, block.value.duration);
    revalidateSchedule();
    return {};
  } catch (err) {
    return fail(err, "Could not move the block.");
  }
}

export async function removeLifeBlock(input: { id: string; wholeSeries: boolean }): Promise<OpResult> {
  try {
    await deleteLifeBlock(input.id, input.wholeSeries);
    revalidateSchedule();
    return {};
  } catch (err) {
    return fail(err, "Could not delete the block.");
  }
}

export type LogResult = {
  ok?: { task: string; url: string; hours: number; total: number; stage: string | null };
  error?: string;
};

/** Adds hours to the task's Hours field, sets Stage and Evidence, posts the session comment. */
export async function logSession(taskGid: string, raw: { hours: unknown; stage?: unknown; evidence?: unknown; notes?: unknown }): Promise<LogResult> {
  const parsed = parseSessionForm(raw);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;

  try {
    const task = await ourTask(taskGid);

    const hoursField = field(task, "Hours");
    const stageField = field(task, "Stage");
    const evidenceField = field(task, "Evidence");
    const missing = [
      !hoursField && "Hours",
      input.stage && !stageField && "Stage",
      input.evidence && !evidenceField && "Evidence",
    ].filter(Boolean);
    if (missing.length) {
      return { error: `This task's project is missing the ${missing.join(", ")} field. Add it to the project first.` };
    }

    const total = addHours(hoursField!.number_value, input.hours);
    const customFields: Record<string, string | number | null> = { [hoursField!.gid]: total };

    if (input.stage) {
      const option = enumOption(stageField, input.stage);
      if (!option) return { error: `The Stage field has no "${input.stage}" option.` };
      customFields[stageField!.gid] = option.gid;
    }
    if (input.evidence) customFields[evidenceField!.gid] = input.evidence;

    const completed = input.stage === "Done" ? true : input.stage ? false : undefined;
    await updateTask(task.gid, {
      custom_fields: customFields,
      ...(completed !== undefined && completed !== task.completed ? { completed } : {}),
    });
    await addComment(task.gid, sessionComment(input));

    revalidatePath("/");
    revalidatePath("/week");
    revalidatePath("/progress", "layout");
    return {
      ok: {
        task: task.name,
        url: task.permalink_url,
        hours: input.hours,
        total,
        stage: input.stage ?? stageField?.enum_value?.name ?? null,
      },
    };
  } catch (err) {
    if (err instanceof AsanaError) return { error: err.message };
    console.error(err);
    return { error: `Could not log ${formatHours(input.hours)} h. Nothing may have been saved; check the task.` };
  }
}

/** Posts this week's status update on a project. Refuses a second one unless force is set. */
export async function postStatusUpdate(input: { project: string; status: string; text: string; force: boolean }): Promise<OpResult> {
  const key = input.project;
  const text = input.text.replace(/\r\n?/g, "\n").trim();
  if (!isProjectKey(key)) return { error: "Unknown project." };
  if (!(input.status in STATUS_TYPES)) return { error: "Choose On track, At risk or Off track." };
  if (text.length < 10) return { error: "The update is empty." };
  if (text.length > 10000) return { error: "The update is too long." };

  try {
    const week = thisWeek();
    if (!input.force && (await listStatusUpdates(key, week.startsAt)).length > 0) {
      return { error: "An update is already posted this week. Tick “Post another” to add a second one." };
    }
    await createStatusUpdate(key, {
      title: `Week of ${shortDate(week.start)}`,
      text,
      status_type: input.status,
    });
    revalidatePath("/week");
    revalidatePath("/");
    revalidatePath(`/progress/${key}`);
    return {};
  } catch (err) {
    if (err instanceof AsanaError) return { error: err.message };
    console.error(err);
    return { error: "Could not post the update. Check the project before trying again." };
  }
}

// ---------------------------------------------------------------------------
// The Tasks dashboard. Native backend only: in Asana these happen in Asana.
// ---------------------------------------------------------------------------

function revalidateTasks() {
  revalidatePath("/", "layout");
}

async function taskChange(run: () => Promise<unknown>, fallback: string): Promise<OpResult> {
  try {
    await run();
    revalidateTasks();
    return {};
  } catch (err) {
    return fail(err, fallback);
  }
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/**
 * Adds a task. The dashboard names its section by gid and Claude by name; with
 * neither it goes in the project's first section.
 */
export async function createTask(input: {
  project: string;
  name: string;
  section?: string | null;
  sectionName?: string | null;
  dueOn?: string | null;
  milestone?: boolean;
  notes?: string | null;
}): Promise<OpResult & { task?: { gid: string; name: string; url: string } }> {
  const name = input.name.trim();
  const dueOn = input.dueOn?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (usesAsana()) return { error: "With TASK_BACKEND=asana, add tasks in Asana." };
  if (!isProjectKey(input.project)) return { error: "Unknown project." };
  if (!name) return { error: "Give the task a name." };
  if (name.length > 500) return { error: "That name is too long." };
  if (notes && notes.length > 20000) return { error: "That description is too long." };
  if (dueOn && !isDate(dueOn)) return { error: "Pick a valid due date." };
  const project: ProjectKey = input.project;

  try {
    let section = input.section || null;
    if (!section) {
      const sections = await native.listSections(project);
      const wanted = input.sectionName?.trim().toLowerCase();
      const match = wanted ? sections.find((s) => s.name.trim().toLowerCase() === wanted) : sections[0];
      if (wanted && !match) {
        return { error: `That project has no section called "${input.sectionName}". It has: ${sections.map((s) => s.name).join(", ") || "none"}.` };
      }
      section = match?.gid ?? null;
    }
    const task = await native.createTask({ project, name, section, dueOn, milestone: Boolean(input.milestone) });
    if (notes) await native.updateTaskFields(task.gid, { notes });
    revalidateTasks();
    return { task: { gid: task.gid, name: task.name, url: task.permalink_url } };
  } catch (err) {
    return fail(err, "Could not add the task.");
  }
}

/** Changes the fields given and leaves the rest. */
export async function editTask(gid: string, input: { name?: string; notes?: string; dueOn?: string; section?: string; evidence?: string }): Promise<OpResult> {
  const changes: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "Give the task a name." };
    if (name.length > 500) return { error: "That name is too long." };
    changes.name = name;
  }
  if (input.notes !== undefined) {
    if (input.notes.length > 20000) return { error: "That description is too long." };
    changes.notes = input.notes;
  }
  if (input.dueOn !== undefined) {
    const dueOn = input.dueOn.trim();
    if (dueOn && !isDate(dueOn)) return { error: "Pick a valid due date." };
    changes.due_on = dueOn || null;
    changes.start_at = null;
  }
  if (input.section !== undefined) changes.section_gid = input.section || null;
  if (input.evidence !== undefined) {
    const evidence = input.evidence.trim();
    if (evidence && !/^https?:\/\//.test(evidence)) return { error: "Evidence must be a link starting with http:// or https://." };
    changes.evidence = evidence;
  }
  return taskChange(() => native.updateTaskFields(gid, changes), "Could not save the task.");
}

/** Moves a task's due day, taking it off the grid if it had a time. */
export async function rescheduleTask(gid: string, date: string): Promise<OpResult> {
  if (!isDate(date)) return { error: "Pick a valid day." };
  return taskChange(async () => {
    const task = await ourTask(gid);
    await updateTask(task.gid, { start_at: null, due_on: date });
  }, "Could not move the task.");
}

/** Adds several tasks to a project in order, from a pasted list. */
export async function createTasks(input: { project: string; names: string[]; section?: string | null }): Promise<OpResult> {
  if (usesAsana()) return { error: "With TASK_BACKEND=asana, add tasks in Asana." };
  if (!isProjectKey(input.project)) return { error: "Unknown project." };
  const names = input.names.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return { error: "Nothing to add." };
  if (names.length > 200) return { error: "Add at most 200 tasks at once." };
  if (names.some((n) => n.length > 500)) return { error: "One of those lines is too long." };
  const project: ProjectKey = input.project;
  return taskChange(async () => {
    const section = input.section || (await native.listSections(project))[0]?.gid || null;
    await native.createTasks(project, names, section);
  }, "Could not add the tasks.");
}

export async function setTaskStage(gid: string, stage: string): Promise<OpResult> {
  if (!(STAGES as readonly string[]).includes(stage)) return { error: "Pick a stage." };
  return taskChange(() => native.updateTaskFields(gid, stageChange(stage)), "Could not change the stage.");
}

export async function setTaskCompleted(gid: string, completed: boolean): Promise<OpResult> {
  return taskChange(async () => {
    const task = await getTask(gid);
    await native.updateTaskFields(gid, completionChange(completed, field(task, "Stage")?.enum_value?.name ?? null));
  }, "Could not update the task.");
}


export async function removeTask(gid: string): Promise<OpResult> {
  return taskChange(() => native.deleteTask(gid), "Could not delete the task.");
}

export async function commentOnTask(gid: string, text: string): Promise<OpResult> {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return { error: "Write a comment first." };
  if (clean.length > 10000) return { error: "That comment is too long." };
  return taskChange(() => addComment(gid, clean), "Could not add the comment.");
}

export async function addSection(project: string, name: string): Promise<OpResult> {
  const clean = name.trim();
  if (!isProjectKey(project)) return { error: "Unknown project." };
  if (!clean) return { error: "Give the section a name." };
  if (clean.length > 120) return { error: "That name is too long." };
  return taskChange(() => native.createSection(project, clean), "Could not add the section.");
}

export async function removeSection(gid: string): Promise<OpResult> {
  return taskChange(() => native.deleteSection(gid), "Could not delete the section.");
}

// ---------------------------------------------------------------------------
// Study
// ---------------------------------------------------------------------------

function studyOnly(): OpResult | null {
  return usesAsana() ? { error: "Study needs the Supabase task backend." } : null;
}

/** Adds what the plan has and the project lacks. Existing work is left alone. */
export async function loadPlan(project: string): Promise<OpResult & { added?: number }> {
  const blocked = studyOnly();
  if (blocked) return blocked;
  const plan = planFor(project);
  if (!plan) return { error: "That project has no study plan." };
  try {
    const added = await native.importPlan(plan.project, planPayload(plan));
    revalidateTasks();
    return { added };
  } catch (err) {
    return fail(err, "Could not load the plan.");
  }
}

/** Spreads a plan's remaining units from a start day. Optional ones are left undated. */
export async function setPace(project: string, perWeek: number, start: string): Promise<OpResult & { last?: string; count?: number }> {
  const blocked = studyOnly();
  if (blocked) return blocked;
  const plan = planFor(project);
  if (!plan) return { error: "That project has no study plan." };
  if (!Number.isFinite(perWeek) || perWeek <= 0 || perWeek > 50) return { error: "Choose how many a week, from 1 to 50." };
  if (!isDate(start)) return { error: "Pick a valid start date." };
  try {
    const tasks = await native.listTasks(plan.project);
    const byRef = new Map(tasks.map((t) => [t.ref, t]));
    const remaining = planUnits(plan)
      .filter((u) => !u.optional)
      .map((u) => byRef.get(u.ref))
      .filter((t): t is NonNullable<typeof t> => Boolean(t && !t.completed && !t.due_at));
    const dated = spreadDates(remaining, start, perWeek);
    await native.setDueDates(dated.map((d) => ({ gid: d.unit.gid, due_on: d.dueOn })));
    revalidateTasks();
    return { count: dated.length, last: dated.at(-1)?.dueOn };
  } catch (err) {
    return fail(err, "Could not set the dates.");
  }
}

/** Saved without refreshing the page, so a run of quick taps stays smooth. */
export async function setExercise(task: string, number: number, status: ExerciseStatus | null): Promise<OpResult> {
  const blocked = studyOnly();
  if (blocked) return blocked;
  if (!Number.isInteger(number) || number < 1 || number > 1000) return { error: "That exercise number is not valid." };
  if (status !== null && !["solved", "hint", "stuck", "skip"].includes(status)) return { error: "Pick a state for the exercise." };
  try {
    await native.setExercise(task, number, status);
    return {};
  } catch (err) {
    return fail(err, "Could not save the exercise.");
  }
}

export async function setExerciseCount(task: string, count: number | null): Promise<OpResult> {
  const blocked = studyOnly();
  if (blocked) return blocked;
  if (count !== null && (!Number.isInteger(count) || count < 0 || count > 1000)) return { error: "Enter a whole number up to 1000." };
  return taskChange(() => native.setExerciseCount(task, count), "Could not save the number of exercises.");
}

export async function addSubtask(task: string, name: string): Promise<OpResult> {
  const clean = name.trim();
  if (!clean) return { error: "Name the step first." };
  if (clean.length > 300) return { error: "That step is too long." };
  return taskChange(() => native.addSubtask(task, clean), "Could not add the step.");
}

export async function setSubtask(gid: string, done: boolean): Promise<OpResult> {
  return taskChange(() => native.setSubtask(gid, done), "Could not update the step.");
}

export async function removeSubtask(gid: string): Promise<OpResult> {
  return taskChange(() => native.deleteSubtask(gid), "Could not delete the step.");
}

/** A prompt of your own. It waits until the unit is finished, unless that has already happened. */
export async function addReview(task: string, prompt: string): Promise<OpResult> {
  const clean = prompt.trim();
  if (!clean) return { error: "Write what to recall first." };
  if (clean.length > 500) return { error: "That is too long for a review." };
  return taskChange(async () => {
    const current = await getTask(task);
    await native.addReview(task, clean, current.completed ? addDays(today(), 1) : null);
  }, "Could not add the review.");
}

export async function rateReview(gid: string, rating: string): Promise<OpResult> {
  const blocked = studyOnly();
  if (blocked) return blocked;
  if (rating !== "got" && rating !== "shaky" && rating !== "missed") return { error: "Rate it as got it, shaky or missed." };
  return taskChange(async () => {
    const { reviews } = await native.studySnapshot();
    const review = reviews.find((r) => r.gid === gid);
    if (!review) throw new AsanaError("That review no longer exists.", 404);
    await native.rateReview(gid, rating, nextReview({ step: review.step, kind: review.kind, rating, today: today() }));
  }, "Could not save the review.");
}

export async function removeReview(gid: string): Promise<OpResult> {
  return taskChange(() => native.deleteReview(gid), "Could not delete the review.");
}

export async function addBenchmark(input: {
  project: string;
  task?: string | null;
  metric: string;
  value: number;
  unit?: string;
  scene?: string;
  gpu?: string;
  commit?: string;
  notes?: string;
}): Promise<OpResult> {
  const blocked = studyOnly();
  if (blocked) return blocked;
  if (!isProjectKey(input.project)) return { error: "Unknown project." };
  const metric = input.metric.trim();
  const commit = (input.commit ?? "").trim().toLowerCase();
  if (!metric || metric.length > 80) return { error: "Name what you measured." };
  if (!Number.isFinite(input.value)) return { error: "Enter the measured value as a number." };
  if (commit && !/^[0-9a-f]{7,40}$/.test(commit)) return { error: "A commit is 7 to 40 letters and digits, a to f and 0 to 9." };
  const project: ProjectKey = input.project;
  return taskChange(
    () =>
      native.addBenchmark({
        project,
        task: input.task || null,
        metric,
        value: input.value,
        unit: (input.unit ?? "").slice(0, 20),
        scene: (input.scene ?? "").slice(0, 120),
        gpu: (input.gpu ?? "").slice(0, 80),
        commit,
        notes: (input.notes ?? "").slice(0, 1000),
      }),
    "Could not save the result.",
  );
}

export async function removeBenchmark(gid: string): Promise<OpResult> {
  return taskChange(() => native.deleteBenchmark(gid), "Could not delete the result.");
}
