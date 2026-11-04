"use server";

import { requireOwner } from "@/lib/access";
import { postStatusUpdate as post } from "@/lib/operations";

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
