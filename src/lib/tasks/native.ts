import "server-only";
import { connectorCaller } from "../connector/context";
import { anonClient } from "../connector/oauth";
import { PROJECTS, type ProjectKey } from "../config/projects";
import { createClient } from "../supabase/server";
import {
  AsanaError,
  nativeChanges,
  nativeToAsanaTask,
  type AsanaStatusUpdate,
  type AsanaStory,
  type AsanaTask,
  type NativeTaskRow,
  type VerifiedProject,
} from "./model";

// Tasks stored in Supabase, with the same functions and shapes as ./asana.ts.
// Who may do what is enforced by the tracker_* RPCs, not here.

export type Section = { gid: string; name: string };

// Absolute when configured, because Claude's connector passes these links on.
const SITE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";

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
  return `${SITE}/tasks?project=${row.project}&task=${row.gid}`;
}

function gidNumber(gid: string): string {
  if (!/^\d{1,18}$/.test(gid)) throw new AsanaError("That is not a task id.", 400);
  return gid;
}

const toTask = (row: NativeTaskRow): AsanaTask => nativeToAsanaTask(row, taskUrl(row));

export async function verifiedProject(key: ProjectKey): Promise<VerifiedProject> {
  const title = PROJECTS.find((p) => p.key === key)?.title ?? key;
  return { key, gid: key, name: title, url: `${SITE}/tasks?project=${key}` };
}

export async function projectKeyOfTask(task: AsanaTask): Promise<ProjectKey | null> {
  const gid = task.memberships?.[0]?.project.gid;
  return PROJECTS.find((p) => p.key === gid)?.key ?? null;
}

export async function listTasks(
  key: ProjectKey,
  options: { completedSince?: Date | "now"; modifiedSince?: Date } = {},
): Promise<AsanaTask[]> {
  const since = options.completedSince === "now" ? new Date() : options.completedSince;
  const rows = await rpc<NativeTaskRow[]>("tracker_tasks", {
    p_project: key,
    p_completed_since: since?.toISOString() ?? null,
    p_modified_since: options.modifiedSince?.toISOString() ?? null,
  });
  return rows.map(toTask);
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
  return rpc<AsanaStatusUpdate[]>("tracker_status_updates", { p_project: key, p_since: since?.toISOString() ?? null });
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
  return rpc<Section[]>("tracker_sections", { p_project: key });
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

export async function deleteTask(gid: string): Promise<void> {
  await rpc("tracker_delete_task", { p_gid: gidNumber(gid) });
}

/** A task's description and section, which the shared task shape leaves out. */
export async function taskDetails(gid: string): Promise<{ notes: string; sectionGid: string | null }> {
  const row = await rpc<NativeTaskRow>("tracker_task", { p_gid: gidNumber(gid) });
  return { notes: row.notes, sectionGid: row.section_gid };
}
