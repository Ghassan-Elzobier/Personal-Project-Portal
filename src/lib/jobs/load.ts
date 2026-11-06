import "server-only";
import { findUnit, PLANS } from "../study/plans";
import { planUnits } from "../study/plan-types";
import { phaseOf, PHASES } from "../study/roadmap";
import { loadStudy, type StudyOverview } from "../study/load";
import { FAMILIES, isCoreFamily } from "./classify";
import { branchImpact, buildStandings, isTarget, isVisible, marketRows, roleFit, unknownTerms, type Band, type Fit, type MarketRow, type Standing, type StoredEvidence, type UnitFact } from "./match";
import { SKILLS } from "./skills";
import { listEvidence, listPostings, listSources, type JobRow, type JobSource } from "./store";

// Everything the job pages and the Today hub show, worked out from the roles on file,
// your study progress and evidence you added.

/** What the plans can say about each unit: finished, practised, measured, and when it is due. */
export function unitFacts(overview: StudyOverview): Map<string, UnitFact> {
  const rows = new Map(overview.plans.flatMap((p) => p.rows.map((r) => [r.unit.ref, r] as const)));
  const measured = new Set(overview.study.benchmarks.filter((b) => b.commit_sha && b.task_gid).map((b) => b.task_gid));
  return new Map(
    PLANS.flatMap((plan) =>
      planUnits(plan).map((unit): [string, UnitFact] => {
        const row = rows.get(unit.ref);
        const phase = phaseOf(unit.ref);
        return [
          unit.ref,
          {
            ref: unit.ref,
            name: unit.short,
            plan: plan.mode,
            done: row?.task.completed ?? false,
            solved: row?.tally.solved ?? 0,
            measured: row ? measured.has(row.task.gid) : false,
            optional: unit.optional ?? false,
            href: row ? `/study?task=${row.task.gid}` : null,
            dueOn: row?.task.dueOn ?? null,
            phase: phase >= 0 ? phase : null,
          },
        ];
      }),
    ),
  );
}

export type RoleView = JobRow & {
  fit: Fit;
  visible: boolean;
  target: boolean;
  /** Not yet looked at. */
  fresh: boolean;
  /** The same role listed for other places, folded into this row. */
  alsoIn: string[];
};

const TIER_ORDER: Record<string, number> = { london: 0, remote: 1, uk: 2, unknown: 3, abroad: 4 };
const BAND_ORDER: Record<Band, number> = { ready: 0, by_date: 1, one_gap: 2, stretch: 3, unread: 4 };
const SENIORITY_ORDER: Record<string, number> = { junior: 0, intern: 1, any: 1, mid: 1, senior: 2, lead: 3 };

const sameRole = (r: JobRow) => `${r.company.toLowerCase()}|${r.title.toLowerCase().replace(/\s+/g, " ").trim()}`;

/**
 * A role you marked comes first, then the closest fit, then whichever leans most on
 * your specialist skills, so the top of the list is about your fields and not just
 * any job that wants Python. Level, place and newest break ties.
 */
function byPriority(a: RoleView, b: RoleView): number {
  return (
    (b.interest ?? -1) - (a.interest ?? -1) ||
    BAND_ORDER[a.fit.band] - BAND_ORDER[b.fit.band] ||
    Number(isCoreFamily(b.family)) - Number(isCoreFamily(a.family)) ||
    b.fit.specialist - a.fit.specialist ||
    (SENIORITY_ORDER[a.seniority] ?? 1) - (SENIORITY_ORDER[b.seniority] ?? 1) ||
    (TIER_ORDER[a.location_tier] ?? 9) - (TIER_ORDER[b.location_tier] ?? 9) ||
    b.first_seen_at.localeCompare(a.first_seen_at)
  );
}

export type FamilyRow = { key: string; name: string; roles: number; ready: number; onPlan: number; oneGap: number };

export type JobBoard = {
  today: string;
  sources: JobSource[];
  roles: RoleView[];
  standings: Map<string, Standing>;
  market: MarketRow[];
  branches: ReturnType<typeof branchImpact>;
  families: FamilyRow[];
  unknown: { term: string; roles: number }[];
  evidence: StoredEvidence[];
  lastRead: string | null;
  units: Map<string, UnitFact>;
};

export async function loadJobBoard(study?: StudyOverview): Promise<JobBoard> {
  const overview = study ?? (await loadStudy());
  const [rows, sources, evidence] = await Promise.all([listPostings(), listSources(), listEvidence()]);
  const units = unitFacts(overview);
  const standings = buildStandings(units, evidence);

  // One row per role, even when an employer posts it once per city. Keep a row you
  // are tracking, and otherwise the nearest place.
  const groups = new Map<string, JobRow[]>();
  for (const row of rows) groups.set(sameRole(row), [...(groups.get(sameRole(row)) ?? []), row]);

  const roles: RoleView[] = [...groups.values()]
    .flatMap((group) => {
      const live = group.filter((r) => !r.closed_at);
      const pool = live.length ? live : group;
      const tracked = pool.filter((r) => r.stage !== "new" || r.interest !== null);
      const sorted = [...pool].sort((a, b) => (TIER_ORDER[a.location_tier] ?? 9) - (TIER_ORDER[b.location_tier] ?? 9));
      const keep = tracked.length ? tracked : sorted.slice(0, 1);
      const others = sorted.filter((r) => !keep.includes(r)).map((r) => r.location).filter(Boolean);
      return keep.map((row) => {
        const fit = roleFit(row.requirements, standings);
        return {
          ...row,
          fit,
          visible: isVisible(row, fit),
          target: isTarget(row, fit),
          fresh: row.stage === "new" && row.interest === null && !row.closed_at,
          alsoIn: others,
        };
      });
    })
    .sort(byPriority);

  const targets = roles.filter((r) => r.target);
  const families = FAMILIES.map((family): FamilyRow => {
    const inFamily = targets.filter((r) => r.family === family.key);
    return {
      key: family.key,
      name: family.name,
      roles: inFamily.length,
      ready: inFamily.filter((r) => r.fit.band === "ready").length,
      onPlan: inFamily.filter((r) => r.fit.band === "by_date").length,
      oneGap: inFamily.filter((r) => r.fit.band === "one_gap").length,
    };
  }).filter((f) => f.roles > 0);

  const reads = sources.map((s) => s.last_ok_at).filter((d): d is string => Boolean(d)).sort();

  return {
    today: overview.today,
    sources,
    roles,
    standings,
    market: marketRows(targets, standings),
    branches: branchImpact(targets, standings),
    families,
    unknown: unknownTerms(targets),
    evidence,
    lastRead: reads.at(-1) ?? null,
    units,
  };
}

/** What each study unit is worth in the market: the skills it teaches and who asks for them. */
export function unitMarket(board: JobBoard, ref: string): { name: string; must: number; soft: number }[] {
  return board.market
    .filter((row) => row.skill.taughtBy?.includes(ref) && row.must + row.soft > 0)
    .map((row) => ({ name: row.skill.name, must: row.must, soft: row.soft }))
    .sort((a, b) => b.must - a.must || b.soft - a.soft);
}

/** The same, for a whole phase of the roadmap, by the phase's position. */
export function phaseMarket(board: JobBoard): Map<number, { name: string; must: number; soft: number }[]> {
  return new Map(
    PHASES.map((phase, index) => {
      const seen = new Map<string, { name: string; must: number; soft: number }>();
      for (const ref of phase.units) for (const row of unitMarket(board, ref)) seen.set(row.name, row);
      return [index, [...seen.values()].sort((a, b) => b.must - a.must || b.soft - a.soft).slice(0, 6)];
    }),
  );
}

export type Hub = {
  fresh: number;
  freshNear: number;
  closest: RoleView | null;
  biggestGap: MarketRow | null;
  nextSkill: MarketRow | null;
  active: number;
  actions: RoleView[];
  lastRead: string | null;
  nextUnit: { name: string; href: string | null; skills: { name: string; must: number; soft: number }[] } | null;
  failing: number;
};

/** One short reading of the job hunt beside your study, for the Today page. */
export function hubFrom(board: JobBoard, overview: StudyOverview): Hub {
  const open = board.roles.filter((r) => !r.closed_at);
  const near = (r: RoleView) => r.location_tier === "london" || r.location_tier === "remote";
  const fresh = open.filter((r) => r.fresh && r.visible);
  const closest = open.filter((r) => r.target && near(r) && r.fit.band !== "unread" && r.fit.band !== "stretch")[0] ?? null;
  const actions = board.roles
    .filter((r) => r.next_action && r.next_action_on && !["rejected", "passed"].includes(r.stage))
    .sort((a, b) => (a.next_action_on ?? "").localeCompare(b.next_action_on ?? ""));
  const current = overview.roadmap.current;
  const nextRef = current?.tracks.flatMap((t) => t.units).find((u) => !u.done && !u.optional);
  const found = nextRef ? findUnit(nextRef.ref) : null;
  return {
    fresh: fresh.length,
    freshNear: fresh.filter(near).length,
    closest,
    biggestGap: board.market.find((m) => m.standing.status === "missing" || m.standing.status === "near") ?? null,
    nextSkill: board.market.find((m) => m.standing.status === "in_plan") ?? null,
    active: board.roles.filter((r) => ["saved", "applied", "interview", "offer"].includes(r.stage) && !r.closed_at).length,
    actions,
    lastRead: board.lastRead,
    nextUnit: nextRef && found ? { name: found.unit.short, href: nextRef.href, skills: unitMarket(board, nextRef.ref).slice(0, 3) } : null,
    failing: board.sources.filter((s) => s.active && s.kind !== "link" && s.last_error && (!s.last_ok_at || s.last_read_at !== s.last_ok_at)).length,
  };
}

/** A plain summary to paste to your mentor or into a Sunday update. */
export function mentorSummary(board: JobBoard): string {
  const targets = board.roles.filter((r) => r.target);
  const line = (r: RoleView) => `- ${r.title}, ${r.company} (${r.location_tier}): ${r.fit.reason}`;
  const top = targets.filter((r) => r.fit.band !== "unread" && r.fit.band !== "stretch").slice(0, 5);
  const gaps = board.market.filter((m) => m.standing.status === "missing" || m.standing.status === "near").slice(0, 6);
  const coming = board.market.filter((m) => m.standing.status === "in_plan").slice(0, 6);
  const active = board.roles.filter((r) => ["saved", "applied", "interview", "offer"].includes(r.stage) && !r.closed_at);
  const stage = (s: string) => active.filter((r) => r.stage === s).length;
  return [
    `Job hunt, ${board.today}`,
    `${targets.length} open roles in scope. Saved ${stage("saved")}, applied ${stage("applied")}, interviewing ${stage("interview")}, offers ${stage("offer")}.`,
    "",
    "Closest roles:",
    ...(top.length ? top.map(line) : ["- None yet."]),
    "",
    "Most-asked skills not in my plan:",
    ...(gaps.length ? gaps.map((m) => `- ${m.skill.name}: required by ${m.must}, wanted by ${m.soft}`) : ["- None yet."]),
    "",
    "Most-asked skills coming in my plan:",
    ...(coming.length ? coming.map((m) => `- ${m.skill.name}: required by ${m.must}${m.standing.next ? `, comes with ${m.standing.next.name}` : ""}`) : ["- None yet."]),
    "",
    "Next direction after phase 3:",
    ...board.branches.map((b) => `- ${b.name}: asked for by ${b.asking} roles, would move ${b.unlocks} up a band`),
  ].join("\n");
}

export const skillChoices = () => SKILLS.map((s) => ({ key: s.key, name: s.name, group: s.group }));
