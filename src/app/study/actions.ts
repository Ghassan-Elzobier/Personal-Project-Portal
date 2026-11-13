"use server";

import { requireOwner } from "@/lib/auth/access";
import * as ops from "@/lib/portal/operations";
import type { ExerciseStatus } from "@/lib/study/review";

export type ActionResult = { error?: string };

export async function loadPlan(project: string): Promise<ActionResult & { added?: number }> {
  await requireOwner();
  return ops.loadPlan(project);
}

export async function loadAllPlans(): Promise<ActionResult & { added?: number }> {
  await requireOwner();
  return ops.loadAllPlans();
}

export async function setRoadmapPace(
  hoursPerWeek: number,
  start: string,
  then?: { from: string; hoursPerWeek: number },
): Promise<ActionResult & { last?: string; count?: number }> {
  await requireOwner();
  return ops.setRoadmapPace(hoursPerWeek, start, then);
}

export async function setPace(
  project: string,
  perWeek: number,
  start: string,
): Promise<ActionResult & { last?: string; count?: number }> {
  await requireOwner();
  return ops.setPace(project, perWeek, start);
}

export async function setExercise(task: string, number: number, status: ExerciseStatus | null): Promise<ActionResult> {
  await requireOwner();
  return ops.setExercise(task, number, status);
}

export async function setExerciseCount(task: string, count: number | null): Promise<ActionResult> {
  await requireOwner();
  return ops.setExerciseCount(task, count);
}

export async function addSubtask(task: string, name: string): Promise<ActionResult> {
  await requireOwner();
  return ops.addSubtask(task, name);
}

export async function setSubtask(gid: string, done: boolean): Promise<ActionResult> {
  await requireOwner();
  return ops.setSubtask(gid, done);
}

export async function removeSubtask(gid: string): Promise<ActionResult> {
  await requireOwner();
  return ops.removeSubtask(gid);
}

export async function addReview(task: string, prompt: string): Promise<ActionResult> {
  await requireOwner();
  return ops.addReview(task, prompt);
}

export async function rateReview(gid: string, rating: string): Promise<ActionResult> {
  await requireOwner();
  return ops.rateReview(gid, rating);
}

export async function removeReview(gid: string): Promise<ActionResult> {
  await requireOwner();
  return ops.removeReview(gid);
}

export async function addBenchmark(input: Parameters<typeof ops.addBenchmark>[0]): Promise<ActionResult> {
  await requireOwner();
  return ops.addBenchmark(input);
}

export async function removeBenchmark(gid: string): Promise<ActionResult> {
  await requireOwner();
  return ops.removeBenchmark(gid);
}
