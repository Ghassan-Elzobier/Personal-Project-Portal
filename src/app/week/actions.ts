"use server";

import { requireOwner } from "@/lib/auth/access";
import { polishWeeklyUpdate as polish, postStatusUpdate as post } from "@/lib/portal/operations";

export type PostState = { posted?: boolean; error?: string };

export async function postStatusUpdate(_prev: PostState, formData: FormData): Promise<PostState> {
  await requireOwner();
  const result = await post({
    project: String(formData.get("project") ?? ""),
    status: String(formData.get("status") ?? ""),
    text: String(formData.get("text") ?? ""),
    force: formData.get("force") === "yes",
  });
  return result.error ? { error: result.error } : { posted: true };
}

/** Claude's write-up of the week on the update's Done line. It only returns text: nothing is posted. */
export async function polishWeeklyUpdate(project: string, text: string): Promise<{ text?: string; error?: string }> {
  await requireOwner();
  return polish(project, text);
}
