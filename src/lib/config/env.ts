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

/** The deployment's weekly study hours. Pages ask studyTarget (src/lib/portal/data.ts), which prefers the pace set on Study. */
export function weeklyHoursTarget(): number | null {
  const n = Number(process.env.PORTAL_WEEKLY_HOURS_TARGET);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The Lunch Flow key for the bank feed (Vercel only), or null when Money is not set up. */
export function lunchflowKey(): string | null {
  return process.env.LUNCHFLOW_API_KEY?.trim() || null;
}

/** The secret Vercel Cron sends with each scheduled call ("Bearer <secret>"). */
export function cronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

/** The key the scheduled bank sync proves itself with; the database holds only its hash. */
export function moneySyncKey(): string | null {
  return process.env.MONEY_SYNC_KEY?.trim() || null;
}

/** Lunch Flow's Personal API, or the end-to-end suite's fake one. */
export function lunchflowBase(): string {
  return process.env.LUNCHFLOW_BASE_URL?.trim().replace(/\/$/, "") || "https://lunchflow.app/api/v1";
}

/** The Claude API key (Vercel only), from the Console organisation linked to the Max plan. */
export function anthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/** The Claude API, or the end-to-end suite's fake one. */
export function anthropicBase(): string {
  return process.env.ANTHROPIC_BASE_URL?.trim().replace(/\/$/, "") || "https://api.anthropic.com";
}

/** Only for the end-to-end suite: where its made-up job pages are served. Never on Vercel. */
export function jobPagesTestOrigin(): string | null {
  if (process.env.VERCEL) return null;
  return process.env.JOB_PAGES_TEST_ORIGIN?.trim().replace(/\/$/, "") || null;
}

/** Problems with configuration, worded for the owner's "Needs attention" list. */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!usesAsana()) return problems;
  if (!asanaToken()) problems.push("ASANA_TOKEN is not set, so nothing can be read from Asana.");
  if (!asanaWorkspaceGid())
    problems.push(
      "ASANA_WORKSPACE_GID is not set, so the portal cannot check projects belong to your personal workspace.",
    );
  for (const p of PROJECTS) {
    if (!projectGid(p.key)) problems.push(`${p.envVar} is not set, so ${p.title} is hidden.`);
  }
  return problems;
}

/** The GitHub repository the deployment was built from ("owner/name"), from Vercel's system variables. */
export function githubRepo(): string | null {
  const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const slug = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  return owner && slug ? `${owner}/${slug}` : null;
}
