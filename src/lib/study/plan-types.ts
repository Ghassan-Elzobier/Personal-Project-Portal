// The shape of a study plan. Plans are data, so the structure of a book lives
// in one place and the Study page and database import both read it.

import type { ProjectKey } from "../config/projects.ts";

export type PlanReview = { kind: "result" | "idea"; prompt: string };

export type PlanUnit = {
  /** Stable key, also stored on the task. Never change one once it has shipped. */
  ref: string;
  name: string;
  /** Short name for links from other units, such as "PMPP 13". */
  short: string;
  notes: string;
  steps: string[];
  exercises?: number;
  reviews?: PlanReview[];
  /** Refs of units worth finishing first. */
  needs?: string[];
  /** Left out of pacing and of what comes next, but still there to do. */
  optional?: boolean;
  milestone?: boolean;
  /** Page to open at: printed for a linked book, the PDF's own for a local file. */
  page?: number;
  /** A rough guess at the work, used to pace the roadmap. Falls back to the plan's default. */
  hours?: number;
  /** Outside references worth having open for this unit. */
  links?: { label: string; url: string }[];
};

export type PlanSection = { name: string; units: PlanUnit[] };

export type StudyPlan = {
  project: ProjectKey;
  mode: "book" | "lab";
  title: string;
  subtitle: string;
  /** What to read before starting, shown above the plan. */
  guidance: string;
  /** A link to the source, with the page when given. Without one, pages show as plain text. */
  sourceUrl?: (page?: number) => string;
  extraLinks?: { label: string; url: string }[];
  defaultPerWeek: number;
  /** Hours for a unit that gives none. */
  defaultHours: number;
  unitLabel: string;
  sections: PlanSection[];
};

export function planUnits(plan: StudyPlan): PlanUnit[] {
  return plan.sections.flatMap((s) => s.units);
}

export function unitHours(unit: PlanUnit, plan: StudyPlan): number {
  return unit.hours ?? plan.defaultHours;
}
