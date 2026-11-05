import type { ProjectKey } from "../config/projects.ts";
import { AXLER } from "./axler.ts";
import { PMPP } from "./pmpp.ts";
import { planUnits, type PlanUnit, type StudyPlan } from "./plan-types.ts";
import { RENDERING } from "./rendering.ts";

export * from "./plan-types.ts";

export const PLANS: readonly StudyPlan[] = [AXLER, PMPP, RENDERING];

export function planFor(project: ProjectKey | string): StudyPlan | undefined {
  return PLANS.find((p) => p.project === project);
}

const UNITS = new Map<string, { unit: PlanUnit; plan: StudyPlan }>(
  PLANS.flatMap((plan) => planUnits(plan).map((unit) => [unit.ref, { unit, plan }] as const)),
);

export function findUnit(ref: string | null | undefined): { unit: PlanUnit; plan: StudyPlan } | undefined {
  return ref ? UNITS.get(ref) : undefined;
}

/** Units in other plans that build on this one, for "this feeds into". */
export function dependents(ref: string): { unit: PlanUnit; plan: StudyPlan }[] {
  return [...UNITS.values()].filter((u) => u.unit.needs?.includes(ref));
}

/** A plan in the shape the import RPC takes. */
export function planPayload(plan: StudyPlan) {
  return plan.sections.map((s) => ({
    name: s.name,
    tasks: s.units.map((u) => ({
      ref: u.ref,
      name: u.name,
      notes: u.notes,
      exercise_count: u.exercises ?? null,
      milestone: u.milestone ?? false,
      subtasks: u.steps,
      reviews: u.reviews ?? [],
    })),
  }));
}
