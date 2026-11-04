"use server";

import { requireOwner } from "@/lib/access";
import { logSession as log, type LogResult } from "@/lib/operations";

export type LogState = LogResult;

export async function logSession(_prev: LogState, formData: FormData): Promise<LogState> {
  await requireOwner();
  return log(String(formData.get("task") ?? ""), {
    hours: formData.get("hours"),
    stage: formData.get("stage"),
    evidence: formData.get("evidence"),
    notes: formData.get("notes"),
  });
}
