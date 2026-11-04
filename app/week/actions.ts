"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/access";
import { AsanaError, createStatusUpdate, listStatusUpdates } from "@/lib/asana";
import { thisWeek } from "@/lib/portal-data";
import { isProjectKey } from "@/lib/projects";
import { STATUS_TYPES } from "@/lib/session-log";
import { shortDate } from "@/lib/week";

export type PostState = { posted?: boolean; error?: string };

export async function postStatusUpdate(_prev: PostState, formData: FormData): Promise<PostState> {
  await requireOwner();

  const key = String(formData.get("project") ?? "");
  const status = String(formData.get("status") ?? "");
  const text = String(formData.get("text") ?? "").replace(/\r\n?/g, "\n").trim();
  const force = formData.get("force") === "yes";

  if (!isProjectKey(key)) return { error: "Unknown project." };
  if (!(status in STATUS_TYPES)) return { error: "Choose On track, At risk or Off track." };
  if (text.length < 10) return { error: "The update is empty." };
  if (text.length > 10000) return { error: "The update is too long for Asana." };

  try {
    const week = thisWeek();
    if (!force && (await listStatusUpdates(key, week.startsAt)).length > 0) {
      return { error: "An update is already posted this week. Tick “Post another” to add a second one." };
    }
    await createStatusUpdate(key, {
      title: `Week of ${shortDate(week.start)}`,
      text,
      status_type: status,
    });
    revalidatePath("/week");
    revalidatePath("/");
    revalidatePath(`/progress/${key}`);
    return { posted: true };
  } catch (err) {
    if (err instanceof AsanaError) return { error: err.message };
    console.error(err);
    return { error: "Could not post the update. Check Asana before trying again." };
  }
}
