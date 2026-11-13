import "server-only";
import { cache } from "react";
import { connectorCaller } from "../connector/context";
import { anonClient } from "../connector/oauth";
import { PROJECTS, type ProjectKey } from "../config/projects";
import { createClient } from "../supabase/server";
import type { BenchmarkRow } from "../study/benchmarks";
import { now } from "@/lib/dates/clock";
import {
  AsanaError,
  filterNativeRows,
  nativeChanges,
  nativeToAsanaTask,
  type AsanaStatusUpdate,
  type AsanaStory,
  type AsanaTask,
  type NativeTaskRow,
  type ExerciseRow,
  type ReviewRow,
  type SessionComment,
  type SubtaskRow,
  type VerifiedProject,
} from "./model";

// Tasks stored in Supabase, with the same functions and shapes as ./asana.ts.
// Who may do what is enforced by the tracker_* RPCs, not here.

export type Section = { gid: string; name: string };


const ERROR_STATUS: Record<string, number> = { "42501": 403, P0002: 404, "22023": 400, "22P02": 400, "22007": 400, "22008": 400, "23514": 400 };

/** Browser calls use the session. Connector calls prove themselves with their token's hash. */
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const connector = connectorCaller();
  const client = connector ? anonClient() : await createClient();
  const { data, error } = await client.rpc(name, connector ? { ...args, p_access_hash: connector.accessHash } : args);
  if (error) {
    const status = ERROR_STATUS[error.code];
    if (!status) console.error(name, error.message);
    // Our own raised messages are written for people; constraint failures are not.
    const readable = status === 403 || status === 404 || error.code === "22023";
    throw new AsanaError(readable ? error.message : status ? "Those values are not valid." : "The task database did not answer. Try again in a minute.", status ?? 500);
  }
  return data as T;
}

function taskUrl(row: NativeTaskRow): string {
  return `/tasks?project=${row.project}&task=${row.gid}`;
}

function gidNumber(gid: string): string {
  if (!/^\d{1,18}$/.test(gid)) throw new AsanaError("That is not a task id.", 400);
  return gid;
}

const toTask = (row: NativeTaskRow): AsanaTask => nativeToAsanaTask(row, taskUrl(row));

export async function verifiedProject(key: ProjectKey): Promise<VerifiedProject> {
  const title = PROJECTS.find((p) => p.key === key)?.title ?? key;
  return { key, gid: key, name: title, url: `/tasks?project=${key}` };
}

export async function projectKeyOfTask(task: AsanaTask): Promise<ProjectKey | null> {
  const gid = task.memberships?.[0]?.project.gid;
  return PROJECTS.find((p) => p.key === gid)?.key ?? null;
}

type Snapshot = {
  projects: ProjectKey[];
  sections: (Section & { project: ProjectKey })[];
  tasks: NativeTaskRow[];
  updates: (AsanaStatusUpdate & { project: ProjectKey })[];
};

/** Everything the caller may read, fetched once per page however many parts ask for it. */
const snapshot = cache(() => rpc<Snapshot>("tracker_snapshot"));

async function readable(key: ProjectKey): Promise<Snapshot> {
  const data = await snapshot();
  if (!data.projects.includes(key)) throw new AsanaError("You do not have access to that project.", 403);
  return data;
}

export async function listTasks(
  key: ProjectKey,
  options: { completedSince?: Date | "now"; modifiedSince?: Date } = {},
): Promise<AsanaTask[]> {
  const data = await readable(key);
  const completedSince = options.completedSince === "now" ? now() : options.completedSince;
  const rows = data.tasks.filter((t) => t.project === key);
  return filterNativeRows(rows, { completedSince, modifiedSince: options.modifiedSince }).map(toTask);
}

export async function getTask(gid: string): Promise<AsanaTask> {
  return toTask(await rpc<NativeTaskRow>("tracker_task", { p_gid: gidNumber(gid) }));
}

export async function updateTask(gid: string, changes: Parameters<typeof nativeChanges>[0]): Promise<void> {
  await rpc("tracker_update_task", { p_gid: gidNumber(gid), p_changes: nativeChanges(changes) });
}

export async function addComment(gid: string, text: string): Promise<void> {
  await rpc("tracker_add_comment", { p_gid: gidNumber(gid), p_text: text });
}

export async function listComments(gid: string): Promise<AsanaStory[]> {
  const comments = await rpc<Omit<AsanaStory, "resource_subtype">[]>("tracker_comments", { p_gid: gidNumber(gid) });
  return comments.map((c) => ({ ...c, resource_subtype: "comment_added" }));
}

export async function listStatusUpdates(key: ProjectKey, since?: Date): Promise<AsanaStatusUpdate[]> {
  const data = await readable(key);
  return data.updates.filter((u) => u.project === key && (!since || new Date(u.created_at) >= since));
}

const commentsSince = cache(async (sinceIso: string): Promise<SessionComment[]> => {
  const rows = await rpc<{ task_gid: string; project: ProjectKey; text: string; created_at: string }[]>("tracker_comments_since", { p_since: sinceIso });
  return rows.map((r) => ({ taskGid: r.task_gid, project: r.project, text: r.text, createdAt: r.created_at }));
});

/** Comments since a moment, for every project the caller can read or one of them. */
export async function listSessionComments(since: Date, key?: ProjectKey): Promise<SessionComment[]> {
  const comments = await commentsSince(since.toISOString());
  return key ? comments.filter((c) => c.project === key) : comments;
}

export async function createStatusUpdate(
  key: ProjectKey,
  update: { title: string; text: string; status_type: string },
): Promise<void> {
  await rpc("tracker_add_status_update", {
    p_project: key,
    p_title: update.title,
    p_text: update.text,
    p_status_type: update.status_type,
  });
}

// What only the native backend can do: the dashboard's own changes.

export async function listSections(key: ProjectKey): Promise<Section[]> {
  const data = await readable(key);
  return data.sections.filter((s) => s.project === key).map(({ gid, name }) => ({ gid, name }));
}

export async function createSection(key: ProjectKey, name: string): Promise<void> {
  await rpc("tracker_create_section", { p_project: key, p_name: name });
}

export async function deleteSection(gid: string): Promise<void> {
  await rpc("tracker_delete_section", { p_gid: gidNumber(gid) });
}

export async function createTask(input: {
  project: ProjectKey;
  name: string;
  section: string | null;
  dueOn: string | null;
  milestone: boolean;
}): Promise<AsanaTask> {
  return toTask(
    await rpc<NativeTaskRow>("tracker_create_task", {
      p_project: input.project,
      p_name: input.name,
      p_section_gid: input.section ? gidNumber(input.section) : null,
      p_due_on: input.dueOn,
      p_milestone: input.milestone,
    }),
  );
}

/** Changes columns directly, including those the shared update has no name for. */
export async function updateTaskFields(gid: string, changes: Record<string, unknown>): Promise<void> {
  await rpc("tracker_update_task", { p_gid: gidNumber(gid), p_changes: changes });
}

/** Adds several tasks at once, in order. Returns how many were added. */
export async function createTasks(key: ProjectKey, names: string[], section: string | null): Promise<number> {
  return rpc<number>("tracker_create_tasks", {
    p_project: key,
    p_names: names,
    p_section_gid: section ? gidNumber(section) : null,
  });
}

export async function deleteTask(gid: string): Promise<void> {
  await rpc("tracker_delete_task", { p_gid: gidNumber(gid) });
}

// ---------------------------------------------------------------------------
// Study: steps, exercises, reviews and benchmarks
// ---------------------------------------------------------------------------

export type StudySnapshot = {
  subtasks: SubtaskRow[];
  exercises: ExerciseRow[];
  reviews: ReviewRow[];
  benchmarks: BenchmarkRow[];
};

export const studySnapshot = cache(() => rpc<StudySnapshot>("tracker_study_snapshot"));

export async function importPlan(key: ProjectKey, plan: unknown): Promise<number> {
  return rpc<number>("tracker_import_plan", { p_project: key, p_plan: plan });
}

export async function setExercise(task: string, number: number, status: ExerciseRow["status"] | null): Promise<void> {
  await rpc("tracker_set_exercise", { p_task: gidNumber(task), p_number: number, p_status: status });
}

export async function setExerciseCount(task: string, count: number | null): Promise<void> {
  await rpc("tracker_set_exercise_count", { p_task: gidNumber(task), p_count: count });
}

export async function addSubtask(task: string, name: string): Promise<void> {
  await rpc("tracker_add_subtask", { p_task: gidNumber(task), p_name: name });
}

export async function setSubtask(gid: string, done: boolean): Promise<void> {
  await rpc("tracker_set_subtask", { p_gid: gidNumber(gid), p_done: done });
}

export async function deleteSubtask(gid: string): Promise<void> {
  await rpc("tracker_delete_subtask", { p_gid: gidNumber(gid) });
}

export async function addReview(task: string, prompt: string, dueOn: string | null): Promise<void> {
  await rpc("tracker_add_review", { p_task: gidNumber(task), p_prompt: prompt, p_due_on: dueOn });
}

export async function rateReview(gid: string, rating: string, next: { step: number; dueOn: string | null; retire: boolean }): Promise<void> {
  await rpc("tracker_rate_review", { p_gid: gidNumber(gid), p_rating: rating, p_step: next.step, p_due_on: next.dueOn, p_retire: next.retire });
}

export async function deleteReview(gid: string): Promise<void> {
  await rpc("tracker_delete_review", { p_gid: gidNumber(gid) });
}

export async function addBenchmark(input: {
  project: ProjectKey;
  task: string | null;
  metric: string;
  value: number;
  unit: string;
  scene: string;
  gpu: string;
  commit: string;
  notes: string;
}): Promise<void> {
  await rpc("tracker_add_benchmark", {
    p_project: input.project,
    p_task: input.task ? gidNumber(input.task) : null,
    p_metric: input.metric,
    p_value: input.value,
    p_unit: input.unit,
    p_scene: input.scene,
    p_gpu: input.gpu,
    p_commit: input.commit,
    p_notes: input.notes,
  });
}

export async function deleteBenchmark(gid: string): Promise<void> {
  await rpc("tracker_delete_benchmark", { p_gid: gidNumber(gid) });
}

export async function setDueDates(items: { gid: string; due_on: string }[]): Promise<void> {
  await rpc("tracker_set_due_dates", { p_items: items });
}
