import "server-only";
import { cache } from "react";
import { asanaToken, asanaWorkspaceGid, projectGid } from "../config/env";
import { PROJECTS, type ProjectKey } from "../config/projects";
import {
  AsanaError,
  type AsanaStatusUpdate,
  type AsanaStory,
  type AsanaTask,
  type SessionComment,
  type VerifiedProject,
} from "./model";

// A small Asana REST client. The token never leaves the server: this module
// imports "server-only", so a client component importing it fails the build.

// ASANA_API_BASE lets `next dev` point at a fake Asana for local testing. It
// is ignored in production builds, so there the token only goes to Asana.
const BASE =
  process.env.NODE_ENV !== "production" && process.env.ASANA_API_BASE
    ? process.env.ASANA_API_BASE
    : "https://app.asana.com/api/1.0";

const TASK_FIELDS = [
  "name",
  "completed",
  "completed_at",
  "due_on",
  "due_at",
  "start_on",
  "start_at",
  "resource_subtype",
  "modified_at",
  "permalink_url",
  "memberships.project.gid",
  "memberships.section.name",
  "custom_fields.gid",
  "custom_fields.name",
  "custom_fields.resource_subtype",
  "custom_fields.display_value",
  "custom_fields.number_value",
  "custom_fields.text_value",
  "custom_fields.enum_value.gid",
  "custom_fields.enum_value.name",
  "custom_fields.enum_options.gid",
  "custom_fields.enum_options.name",
  "custom_fields.enum_options.enabled",
].join(",");

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = asanaToken();
  if (!token) throw new AsanaError("ASANA_TOKEN is not set.", 500);

  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify({ data: init.body }) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Asana answered ${res.status}.`;
    try {
      const body = (await res.json()) as { errors?: { message?: string }[] };
      if (body.errors?.[0]?.message) message = `Asana: ${body.errors[0].message}`;
    } catch {
      // keep the generic message
    }
    throw new AsanaError(message, res.status);
  }
  return res.json() as Promise<T>;
}

async function getData<T>(path: string): Promise<T> {
  return (await request<{ data: T }>(path)).data;
}

async function getAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ ...params, limit: "100", ...(offset ? { offset } : {}) });
    const body = await request<{ data: T[]; next_page?: { offset: string } | null }>(`${path}?${query}`);
    items.push(...body.data);
    offset = body.next_page?.offset;
    if (!offset) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Projects, with the personal-workspace guard
// ---------------------------------------------------------------------------

/**
 * The project for this key, after checking it belongs to the configured
 * personal workspace. Anything else is refused, so a mistyped gid can never
 * pull work data into the portal. Cached per request.
 */
export const verifiedProject = cache(async (key: ProjectKey): Promise<VerifiedProject> => {
  const gid = projectGid(key);
  const title = PROJECTS.find((p) => p.key === key)?.title ?? key;
  if (!gid) throw new AsanaError(`No Asana project is configured for ${title}.`, 404);
  const workspace = asanaWorkspaceGid();
  if (!workspace) throw new AsanaError("ASANA_WORKSPACE_GID is not set.", 500);

  const project = await getData<{ gid: string; name: string; permalink_url: string; workspace: { gid: string } }>(
    `/projects/${gid}?opt_fields=name,permalink_url,workspace.gid`,
  );
  if (project.workspace.gid !== workspace) {
    throw new AsanaError(
      `The Asana project set for ${title} is not in your personal workspace, so the portal will not read it. Check its gid.`,
      403,
    );
  }
  return { key, gid: project.gid, name: project.name, url: project.permalink_url };
});

/** The configured project key a task belongs to, or null if it is not ours. */
export async function projectKeyOfTask(task: AsanaTask): Promise<ProjectKey | null> {
  const gids = new Set(task.memberships?.map((m) => m.project.gid) ?? []);
  for (const p of PROJECTS) {
    const gid = projectGid(p.key);
    if (gid && gids.has(gid)) {
      await verifiedProject(p.key);
      return p.key;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function listTasks(
  key: ProjectKey,
  options: { completedSince?: Date | "now"; modifiedSince?: Date } = {},
): Promise<AsanaTask[]> {
  const project = await verifiedProject(key);
  const params: Record<string, string> = { project: project.gid, opt_fields: TASK_FIELDS };
  if (options.completedSince) {
    params.completed_since = options.completedSince === "now" ? "now" : options.completedSince.toISOString();
  }
  if (options.modifiedSince) params.modified_since = options.modifiedSince.toISOString();
  return getAll<AsanaTask>("/tasks", params);
}

export async function getTask(gid: string): Promise<AsanaTask> {
  if (!/^\d+$/.test(gid)) throw new AsanaError("That is not a task id.", 400);
  return getData<AsanaTask>(`/tasks/${gid}?opt_fields=${TASK_FIELDS}`);
}

export async function updateTask(
  gid: string,
  changes: {
    custom_fields?: Record<string, string | number | null>;
    completed?: boolean;
    start_at?: string | null;
    due_at?: string | null;
    start_on?: string | null;
    due_on?: string | null;
  },
): Promise<void> {
  await request(`/tasks/${gid}`, { method: "PUT", body: changes });
}

export async function addComment(gid: string, text: string): Promise<void> {
  await request(`/tasks/${gid}/stories`, { method: "POST", body: { text } });
}

export async function listComments(gid: string): Promise<AsanaStory[]> {
  const stories = await getAll<AsanaStory>(`/tasks/${gid}/stories`, {
    opt_fields: "created_at,text,resource_subtype",
  });
  return stories.filter((s) => s.resource_subtype === "comment_added");
}

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

export async function listStatusUpdates(key: ProjectKey, since?: Date): Promise<AsanaStatusUpdate[]> {
  const project = await verifiedProject(key);
  const params: Record<string, string> = {
    parent: project.gid,
    opt_fields: "title,text,status_type,created_at",
  };
  if (since) params.created_since = since.toISOString();
  const updates = await getAll<AsanaStatusUpdate>("/status_updates", params);
  return updates.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createStatusUpdate(
  key: ProjectKey,
  update: { title: string; text: string; status_type: string },
): Promise<void> {
  const project = await verifiedProject(key);
  await request("/status_updates", { method: "POST", body: { parent: project.gid, ...update } });
}

// ---------------------------------------------------------------------------
// Comments across tasks
// ---------------------------------------------------------------------------

/** Asana has no bulk read, so this asks each task changed since then. */
export async function listSessionComments(since: Date, key?: ProjectKey): Promise<SessionComment[]> {
  const keys = key ? [key] : PROJECTS.filter((p) => projectGid(p.key)).map((p) => p.key);
  const perProject = await Promise.all(
    keys.map(async (k) => {
      const tasks = await listTasks(k, { modifiedSince: since });
      const perTask = await Promise.all(
        tasks.map(async (t) =>
          (await listComments(t.gid))
            .filter((c) => new Date(c.created_at) >= since)
            .map((c) => ({ taskGid: t.gid, project: k, text: c.text, createdAt: c.created_at })),
        ),
      );
      return perTask.flat();
    }),
  );
  return perProject.flat();
}
