"use server";

import { requireOwner } from "@/lib/auth/access";
import * as ops from "@/lib/portal/operations";

export type ActionResult = { error?: string };

export async function createTask(input: { project: string; name: string; section?: string | null; dueOn?: string | null; milestone?: boolean }): Promise<ActionResult> {
  await requireOwner();
  const { error } = await ops.createTask(input);
  return error ? { error } : {};
}

export async function editTask(gid: string, input: { name: string; notes: string; dueOn: string; section: string; evidence: string }): Promise<ActionResult> {
  await requireOwner();
  return ops.editTask(gid, input);
}

export async function setTaskStage(gid: string, stage: string): Promise<ActionResult> {
  await requireOwner();
  return ops.setTaskStage(gid, stage);
}

export async function setTaskCompleted(gid: string, completed: boolean): Promise<ActionResult> {
  await requireOwner();
  return ops.setTaskCompleted(gid, completed);
}

export async function removeTask(gid: string): Promise<ActionResult> {
  await requireOwner();
  return ops.removeTask(gid);
}

export async function commentOnTask(gid: string, text: string): Promise<ActionResult> {
  await requireOwner();
  return ops.commentOnTask(gid, text);
}

export async function addSection(project: string, name: string): Promise<ActionResult> {
  await requireOwner();
  return ops.addSection(project, name);
}

export async function removeSection(gid: string): Promise<ActionResult> {
  await requireOwner();
  return ops.removeSection(gid);
}
