// The job hunt as a mentor sees it, worked out from the cut-down read that
// tracker_mentor_job_source returns. It uses the same matching as the owner's pages,
// so both see the same bands and the same skills gap, without any of the owner's notes.

import { PLANS } from "../study/plans.ts";
import { planUnits } from "../study/plan-types.ts";
import { phaseOf } from "../study/roadmap.ts";
import { FAMILIES, isCoreFamily } from "./classify.ts";
import type { Details, Requirement, Seniority } from "./extract.ts";
import {
  branchImpact,
  buildStandings,
  isTarget,
  marketRows,
  roleFit,
  type Band,
  type Fit,
  type MarketRow,
  type RoleInput,
  type StoredEvidence,
  type UnitFact,
} from "./match.ts";

export type MentorSource = {
  postings: {
    gid: string;
    title: string;
    company: string;
    location_tier: string;
    family: string;
    seniority: Seniority;
    closed_at: string | null;
    stage: string;
    interest: number | null;
    details: Details;
    requirements: Requirement[];
  }[];
  evidence: StoredEvidence[];
  units: { ref: string; done: boolean; due_on: string | null; solved: number; measured: boolean }[];
  last_read: string | null;
};

export type MentorRole = RoleInput & { fit: Fit };

/** The owner's pages speak to the owner. A mentor reads the same facts about him. */
export function thirdPerson(text: string): string {
  return text
    .replace(/\bYou can show\b/g, "Can show")
    .replace(/\byour plan\b/g, "the plan")
    .replace(/\byour skill list\b/g, "the skill list")
    .replace(/\bYour plan\b/g, "The plan");
}

const STAGES = ["saved", "applied", "interview", "offer", "rejected"] as const;
const TIER_ORDER: Record<string, number> = { london: 0, remote: 1, uk: 2, unknown: 3, abroad: 4 };
const BAND_ORDER: Record<Band, number> = { ready: 0, by_date: 1, one_gap: 2, stretch: 3, unread: 4 };
const SENIORITY_ORDER: Record<string, number> = { junior: 0, intern: 1, any: 1, mid: 1, senior: 2, lead: 3 };

/** Units with no links: a mentor cannot open the owner's study panels. */
export function unitFactsFrom(rows: MentorSource["units"]): Map<string, UnitFact> {
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  return new Map(
    PLANS.flatMap((plan) =>
      planUnits(plan).map((unit): [string, UnitFact] => {
        const row = byRef.get(unit.ref);
        const phase = phaseOf(unit.ref);
        return [
          unit.ref,
          {
            ref: unit.ref,
            name: unit.short,
            plan: plan.mode,
            done: row?.done ?? false,
            solved: row?.solved ?? 0,
            measured: row?.measured ?? false,
            optional: unit.optional ?? false,
            href: null,
            dueOn: row?.due_on ?? null,
            phase: phase >= 0 ? phase : null,
          },
        ];
      }),
    ),
  );
}

export function mentorJobView(source: MentorSource) {
  const standings = buildStandings(unitFactsFrom(source.units), source.evidence);

  // One row per role, as on the owner's page: a role posted per city counts once.
  const seen = new Map<string, MentorRole>();
  for (const posting of [...source.postings].sort(
    (a, b) => (TIER_ORDER[a.location_tier] ?? 9) - (TIER_ORDER[b.location_tier] ?? 9),
  )) {
    const key = `${posting.company.toLowerCase()}|${posting.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const existing = seen.get(key);
    if (existing && (existing.stage !== "new" || posting.stage === "new")) continue;
    const fit = roleFit(posting.requirements, standings);
    seen.set(key, { ...posting, fit: { ...fit, reason: thirdPerson(fit.reason) } });
  }
  const roles = [...seen.values()];
  const targets = roles.filter((r) => isTarget(r, r.fit));

  const closest = targets
    .filter((r) => r.fit.band === "ready" || r.fit.band === "by_date" || r.fit.band === "one_gap")
    .sort(
      (a, b) =>
        BAND_ORDER[a.fit.band] - BAND_ORDER[b.fit.band] ||
        Number(isCoreFamily(b.family)) - Number(isCoreFamily(a.family)) ||
        b.fit.specialist - a.fit.specialist ||
        (SENIORITY_ORDER[a.seniority] ?? 1) - (SENIORITY_ORDER[b.seniority] ?? 1) ||
        (TIER_ORDER[a.location_tier] ?? 9) - (TIER_ORDER[b.location_tier] ?? 9),
    )
    .slice(0, 10);

  const market: MarketRow[] = marketRows(targets, standings);
  const families = FAMILIES.map((f) => {
    const inFamily = targets.filter((r) => r.family === f.key);
    return {
      key: f.key,
      name: f.name,
      roles: inFamily.length,
      ready: inFamily.filter((r) => r.fit.band === "ready").length,
      onPlan: inFamily.filter((r) => r.fit.band === "by_date").length,
      oneGap: inFamily.filter((r) => r.fit.band === "one_gap").length,
    };
  }).filter((f) => f.roles > 0);

  const applications = roles.filter((r) => (STAGES as readonly string[]).includes(r.stage));
  return {
    inScope: targets.length,
    nearby: targets.filter((r) => r.location_tier === "london" || r.location_tier === "remote").length,
    families,
    closest,
    gaps: market.filter((m) => m.standing.status === "missing" || m.standing.status === "near").slice(0, 15),
    coming: market.filter((m) => m.standing.status === "in_plan").slice(0, 15),
    showing: market.filter((m) => m.standing.status === "evidenced").slice(0, 15),
    branches: branchImpact(targets, standings),
    pipeline: Object.fromEntries(STAGES.map((s) => [s, applications.filter((r) => r.stage === s).length])) as Record<
      (typeof STAGES)[number],
      number
    >,
    applications: applications.filter((r) => r.stage !== "rejected"),
    lastRead: source.last_read,
  };
}
