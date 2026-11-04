"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/access";
import { AsanaError, getTask, projectKeyOfTask, updateTask } from "@/lib/asana";
import { timeZone } from "@/lib/env";
import { createLifeBlock, deleteLifeBlock, GoogleError, moveLifeBlock } from "@/lib/google";
import { isLifeKind, parseBlock, REPEATS, type Repeat } from "@/lib/life-blocks";
import { createClient } from "@/lib/supabase/server";
import { weekdayIndex, zonedInstant } from "@/lib/week";

export type ActionResult = { error?: string };

function done(): ActionResult {
  revalidatePath("/schedule");
  revalidatePath("/");
  return {};
}

function fail(err: unknown, fallback: string): ActionResult {
  if (err instanceof AsanaError || err instanceof GoogleError) return { error: err.message };
  console.error(err);
  return { error: fallback };
}

async function ourTask(gid: string) {
  const task = await getTask(gid);
  if (!(await projectKeyOfTask(task))) throw new AsanaError("That task is not in one of the portal's projects.", 403);
  return task;
}

/** Puts an Asana task in a time slot: sets its start and due time. */
export async function scheduleTask(input: { gid: string; date: string; start: number; duration: number }): Promise<ActionResult> {
  await requireOwner();
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
    return done();
  } catch (err) {
    return fail(err, "Could not schedule the task. Check it in Asana.");
  }
}

/** Takes a task off the grid but keeps it due that day. */
export async function unscheduleTask(input: { gid: string; date: string }): Promise<ActionResult> {
  await requireOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Pick a day." };
  try {
    const task = await ourTask(input.gid);
    await updateTask(task.gid, { start_at: null, due_on: input.date });
    return done();
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
}): Promise<ActionResult> {
  await requireOwner();
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
    return done();
  } catch (err) {
    return fail(err, "Could not add the block to Google Calendar.");
  }
}

export async function moveBlock(input: {
  source: "asana" | "google";
  id: string;
  date: string;
  start: number;
  duration: number;
}): Promise<ActionResult> {
  if (input.source === "asana") return scheduleTask({ gid: input.id, ...input });
  await requireOwner();
  const block = parseBlock(input);
  if (!block.ok) return { error: block.error };
  try {
    await moveLifeBlock(input.id, block.value.date, block.value.start, block.value.duration);
    return done();
  } catch (err) {
    return fail(err, "Could not move the block.");
  }
}

export async function removeLifeBlock(input: { id: string; wholeSeries: boolean }): Promise<ActionResult> {
  await requireOwner();
  try {
    await deleteLifeBlock(input.id, input.wholeSeries);
    return done();
  } catch (err) {
    return fail(err, "Could not delete the block.");
  }
}

export async function disconnectGoogle(): Promise<void> {
  await requireOwner();
  const supabase = await createClient();
  await supabase.rpc("clear_google_connection");
  revalidatePath("/schedule");
}
