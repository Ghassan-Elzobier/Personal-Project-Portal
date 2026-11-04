"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/access";
import { addComment, AsanaError, enumOption, field, getTask, projectKeyOfTask, updateTask } from "@/lib/asana";
import { addHours, formatHours, parseSessionForm, sessionComment } from "@/lib/session-log";

export type LogState = {
  ok?: { task: string; url: string; hours: number; total: number; stage: string | null };
  error?: string;
};

export async function logSession(_prev: LogState, formData: FormData): Promise<LogState> {
  await requireOwner();

  const taskGid = String(formData.get("task") ?? "");
  const parsed = parseSessionForm({
    hours: formData.get("hours"),
    stage: formData.get("stage"),
    evidence: formData.get("evidence"),
    notes: formData.get("notes"),
  });
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;

  try {
    const task = await getTask(taskGid);
    // Only tasks in a configured, verified personal project can be written.
    if (!(await projectKeyOfTask(task))) {
      return { error: "That task is not in one of the portal's projects." };
    }

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
