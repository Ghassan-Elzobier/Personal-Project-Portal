import "server-only";
import { PROJECTS, type ProjectKey } from "./projects";

/** Tasks live in Supabase unless TASK_BACKEND=asana. */
export function usesAsana(): boolean {
  return process.env.TASK_BACKEND?.trim().toLowerCase() === "asana";
}

export function asanaToken(): string | null {
  return process.env.ASANA_TOKEN?.trim() || null;
}

export function asanaWorkspaceGid(): string | null {
  return process.env.ASANA_WORKSPACE_GID?.trim() || null;
}

export function projectGid(key: ProjectKey): string | null {
  if (!usesAsana()) return key;
  const def = PROJECTS.find((p) => p.key === key);
  const value = def ? process.env[def.envVar]?.trim() : undefined;
  return value && /^\d+$/.test(value) ? value : null;
}

export function timeZone(): string {
  const tz = process.env.PORTAL_TIMEZONE?.trim();
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function weeklyHoursTarget(): number | null {
  const n = Number(process.env.PORTAL_WEEKLY_HOURS_TARGET);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Problems with configuration, worded for the owner's "Needs attention" list. */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!usesAsana()) return problems;
  if (!asanaToken()) problems.push("ASANA_TOKEN is not set, so nothing can be read from Asana.");
  if (!asanaWorkspaceGid()) problems.push("ASANA_WORKSPACE_GID is not set, so the portal cannot check projects belong to your personal workspace.");
  for (const p of PROJECTS) {
    if (!projectGid(p.key)) problems.push(`${p.envVar} is not set, so ${p.title} is hidden.`);
  }
  return problems;
}
