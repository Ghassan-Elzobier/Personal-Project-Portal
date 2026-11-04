import "server-only";
import { revalidatePath } from "next/cache";
import { addComment, AsanaError, createStatusUpdate, enumOption, field, getTask, listStatusUpdates, projectKeyOfTask, updateTask } from "./asana";
import { timeZone } from "./env";
import { createLifeBlock, deleteLifeBlock, GoogleError, moveLifeBlock } from "./google";
import { isLifeKind, parseBlock, REPEATS, type Repeat } from "./life-blocks";
import { thisWeek } from "./portal-data";
import { isProjectKey } from "./projects";
import { addHours, formatHours, parseSessionForm, sessionComment, STATUS_TYPES } from "./session-log";
import { shortDate, weekdayIndex, zonedInstant } from "./week";

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
  if (!/^\d{1,30}$/.test(gid)) throw new AsanaError("That is not an Asana task id.", 400);
  const task = await getTask(gid);
  if (!(await projectKeyOfTask(task))) throw new AsanaError("That task is not in one of the portal's projects.", 403);
  return task;
}

/** Puts an Asana task in a time slot: sets its start and due time. */
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
    return fail(err, "Could not schedule the task. Check it in Asana.");
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
      return { error: `This task's project is missing the ${missing.join(", ")} field. Add it in Asana first.` };
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
    return { error: `Could not log ${formatHours(input.hours)} h. Nothing may have been saved; check the task in Asana.` };
  }
}

/** Posts this week's status update on a project. Refuses a second one unless force is set. */
export async function postStatusUpdate(input: { project: string; status: string; text: string; force: boolean }): Promise<OpResult> {
  const key = input.project;
  const text = input.text.replace(/\r\n?/g, "\n").trim();
  if (!isProjectKey(key)) return { error: "Unknown project." };
  if (!(input.status in STATUS_TYPES)) return { error: "Choose On track, At risk or Off track." };
  if (text.length < 10) return { error: "The update is empty." };
  if (text.length > 10000) return { error: "The update is too long for Asana." };

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
    return { error: "Could not post the update. Check Asana before trying again." };
  }
}
