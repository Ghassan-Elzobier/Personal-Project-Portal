// The task model the whole portal works with. It follows Asana's shape, and its
// names, so the Asana client stays thin and the native backend in
// src/lib/tasks/native.ts is a drop-in. Pure, so it is tested with node's test runner.

import type { ProjectKey } from "../config/projects";

export class AsanaError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type AsanaEnumOption = { gid: string; name: string; enabled?: boolean };

export type AsanaField = {
  gid: string;
  name: string;
  resource_subtype: "text" | "number" | "enum" | "multi_enum" | "date" | "people" | string;
  display_value: string | null;
  number_value?: number | null;
  text_value?: string | null;
  enum_value?: AsanaEnumOption | null;
  enum_options?: AsanaEnumOption[];
};

export type AsanaTask = {
  gid: string;
  name: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  due_at: string | null;
  start_on: string | null;
  start_at: string | null;
  /** "default_task", "milestone" or "approval". */
  resource_subtype: string;
  modified_at: string;
  permalink_url: string;
  custom_fields: AsanaField[];
  memberships?: { project: { gid: string }; section?: { gid?: string; name: string } | null }[];
  /** The description. Only the native backend reads it. */
  notes?: string;
  /** The study plan unit this task came from, if any. Native backend only. */
  ref?: string | null;
  exerciseCount?: number | null;
};

export type AsanaStory = { gid: string; created_at: string; text: string; resource_subtype: string };

export type AsanaStatusUpdate = {
  gid: string;
  title: string;
  text: string;
  status_type: string;
  created_at: string;
};

export type SubtaskRow = { gid: string; task_gid: string; name: string; done: boolean };
export type ExerciseRow = { task_gid: string; number: number; status: "solved" | "hint" | "stuck" | "skip"; updated_at: string };
export type ReviewRow = {
  gid: string;
  task_gid: string;
  kind: string;
  prompt: string;
  step: number;
  due_on: string | null;
  last_rating: string | null;
  last_reviewed_at: string | null;
};

/** A comment found while totalling hours, with the task it belongs to. */
export type SessionComment = { taskGid: string; project: ProjectKey; text: string; createdAt: string };

export type VerifiedProject = { key: ProjectKey; gid: string; name: string; url: string };

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export function field(task: AsanaTask, name: string): AsanaField | undefined {
  const wanted = name.toLowerCase();
  return task.custom_fields.find((f) => f.name.trim().toLowerCase() === wanted);
}

export function enumOption(f: AsanaField | undefined, name: string): AsanaEnumOption | undefined {
  const wanted = name.toLowerCase();
  return f?.enum_options?.find((o) => o.enabled !== false && o.name.trim().toLowerCase() === wanted);
}

// ---------------------------------------------------------------------------
// Native rows
// ---------------------------------------------------------------------------

/** A task as the tracker_* RPCs return it. */
export type NativeTaskRow = {
  gid: string;
  project: ProjectKey;
  section_gid: string | null;
  section_name: string | null;
  name: string;
  notes: string;
  resource_subtype: string;
  completed: boolean;
  completed_at: string | null;
  start_on: string | null;
  due_on: string | null;
  start_at: string | null;
  due_at: string | null;
  stage: string;
  hours: number | string;
  evidence: string | null;
  modified_at: string;
  ref?: string | null;
  exercise_count?: number | null;
};

const NATIVE_STAGES = ["Not started", "In progress", "Blocked", "Needs review", "Done"];

/** Stage, Hours and Evidence as the custom fields Asana would return. */
export function nativeToAsanaTask(row: NativeTaskRow, url: string): AsanaTask {
  const hours = Number(row.hours) || 0;
  return {
    gid: row.gid,
    name: row.name,
    completed: row.completed,
    completed_at: row.completed_at,
    due_on: row.due_on,
    due_at: row.due_at,
    start_on: row.start_on,
    start_at: row.start_at,
    resource_subtype: row.resource_subtype,
    modified_at: row.modified_at,
    permalink_url: url,
    memberships: [{ project: { gid: row.project }, section: row.section_name ? { gid: row.section_gid ?? undefined, name: row.section_name } : null }],
    notes: row.notes,
    ref: row.ref ?? null,
    exerciseCount: row.exercise_count ?? null,
    custom_fields: [
      {
        gid: "stage",
        name: "Stage",
        resource_subtype: "enum",
        display_value: row.stage,
        enum_value: { gid: row.stage, name: row.stage },
        enum_options: NATIVE_STAGES.map((name) => ({ gid: name, name, enabled: true })),
      },
      { gid: "hours", name: "Hours", resource_subtype: "number", display_value: String(hours), number_value: hours },
      { gid: "evidence", name: "Evidence", resource_subtype: "text", display_value: row.evidence, text_value: row.evidence },
    ],
  };
}

/** Turns an Asana-style task update into the native update's columns. */
export function nativeChanges(changes: {
  custom_fields?: Record<string, string | number | null>;
  [key: string]: unknown;
}): Record<string, unknown> {
  const { custom_fields: fields, ...rest } = changes;
  return { ...rest, ...fields };
}

/** Asana's task list filters: open plus finished since, and changed since. */
export function filterNativeRows(rows: NativeTaskRow[], options: { completedSince?: Date; modifiedSince?: Date }): NativeTaskRow[] {
  const { completedSince, modifiedSince } = options;
  return rows.filter(
    (r) =>
      (!completedSince || !r.completed || (r.completed_at !== null && new Date(r.completed_at) >= completedSince)) &&
      (!modifiedSince || new Date(r.modified_at) >= modifiedSince),
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Stage and completion move together: Done means completed, and back again. */
export function stageChange(stage: string): { stage: string; completed: boolean } {
  return { stage, completed: stage === "Done" };
}

export function completionChange(completed: boolean, stage: string | null): { completed: boolean; stage?: string } {
  if (completed) return { completed, stage: "Done" };
  return stage === "Done" || stage === null ? { completed, stage: "In progress" } : { completed };
}

type Countable = { completed: boolean; dueOn: string | null; hours: number; stage: string | null };

export type ProjectStats = {
  total: number;
  open: number;
  done: number;
  overdue: number;
  hours: number;
  percent: number;
  stages: { stage: string; count: number }[];
};

export function projectStats(tasks: Countable[], today: string): ProjectStats {
  const done = tasks.filter((t) => t.completed).length;
  return {
    total: tasks.length,
    open: tasks.length - done,
    done,
    overdue: tasks.filter((t) => !t.completed && t.dueOn !== null && t.dueOn < today).length,
    hours: Math.round(tasks.reduce((sum, t) => sum + t.hours, 0) * 100) / 100,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    stages: NATIVE_STAGES.map((stage) => ({
      stage,
      count: tasks.filter((t) => (t.stage ?? "Not started") === stage).length,
    })).filter((s) => s.count > 0),
  };
}

/** Tasks under their sections, in section order. Tasks with no section come last. */
export function groupBySection<T extends { sectionGid: string | null }>(
  sections: { gid: string; name: string }[],
  tasks: T[],
): { gid: string | null; name: string; tasks: T[] }[] {
  const known = new Set(sections.map((s) => s.gid));
  const groups: { gid: string | null; name: string; tasks: T[] }[] = sections.map((s) => ({
    ...s,
    tasks: tasks.filter((t) => t.sectionGid === s.gid),
  }));
  const loose = tasks.filter((t) => t.sectionGid === null || !known.has(t.sectionGid));
  if (loose.length) groups.push({ gid: null, name: "No section", tasks: loose });
  return groups;
}
