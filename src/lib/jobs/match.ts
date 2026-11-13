// Where you stand against a role, and what the roles you care about keep asking for.
// All of it is plain data and rules, so the same inputs always give the same answer
// and every status can be traced to a unit, a commit or a line in the advert.

import { isCoreFamily } from "./classify.ts";
import type { Details, Requirement, RequirementLevel, Seniority } from "./extract.ts";
import { BRANCHES, SKILLS, skillByKey, type Skill } from "./skills.ts";

export type SkillStatus = "evidenced" | "in_plan" | "near" | "missing";

export type EvidenceItem = { level: number; label: string; href: string | null };

export type Standing = {
  key: string;
  name: string;
  level: number;
  status: SkillStatus;
  evidence: EvidenceItem[];
  /** The next unit that teaches it, if it is still to do. */
  next: {
    ref: string;
    name: string;
    href: string | null;
    dueOn: string | null;
    phase: number | null;
    optional: boolean;
  } | null;
  /** The skill you already have that makes this quicker to learn. */
  nearName: string | null;
};

export type UnitFact = {
  ref: string;
  name: string;
  plan: "book" | "lab";
  done: boolean;
  /** Exercises solved, so finished reading can be told apart from practice. */
  solved: number;
  /** A result recorded against this unit, with the commit that produced it. */
  measured: boolean;
  optional: boolean;
  href: string | null;
  dueOn: string | null;
  phase: number | null;
};

export type StoredEvidence = { gid: string; skill: string; level: number; note: string; url: string | null };

/** Your standing on one skill, from the plans' progress and evidence you added. */
function standingOf(
  skill: Skill,
  units: ReadonlyMap<string, UnitFact>,
  stored: readonly StoredEvidence[],
): Omit<Standing, "status" | "nearName"> {
  const evidence: EvidenceItem[] = stored
    .filter((e) => e.skill === skill.key)
    .map((e) => ({ level: e.level, label: e.note, href: e.url }));
  let next: Standing["next"] = null;
  for (const ref of skill.taughtBy ?? []) {
    const unit = units.get(ref);
    if (!unit) continue;
    if (unit.done) {
      const level = unit.plan === "lab" ? (unit.measured ? 3 : 2) : unit.solved > 0 ? 2 : 1;
      evidence.push({ level, label: unit.name, href: unit.href });
    } else if (!next || (next.optional && !unit.optional)) {
      next = { ref, name: unit.name, href: unit.href, dueOn: unit.dueOn, phase: unit.phase, optional: unit.optional };
    }
  }
  evidence.sort((a, b) => b.level - a.level);
  return { key: skill.key, name: skill.name, level: evidence[0]?.level ?? 0, evidence, next };
}

/** Practised or better counts as evidence. Reading a chapter does not, on its own. */
const EVIDENCED_FROM = 2;

export function buildStandings(
  units: ReadonlyMap<string, UnitFact>,
  stored: readonly StoredEvidence[],
): Map<string, Standing> {
  const raw = new Map(SKILLS.map((s) => [s.key, standingOf(s, units, stored)]));
  return new Map(
    SKILLS.map((skill) => {
      const r = raw.get(skill.key)!;
      const nearSkill = (skill.near ?? []).find((k) => (raw.get(k)?.level ?? 0) >= EVIDENCED_FROM);
      const status: SkillStatus =
        r.level >= EVIDENCED_FROM ? "evidenced" : r.next ? "in_plan" : nearSkill ? "near" : "missing";
      return [skill.key, { ...r, status, nearName: nearSkill ? (skillByKey(nearSkill)?.name ?? null) : null }];
    }),
  );
}

export type Band = "ready" | "by_date" | "one_gap" | "stretch" | "unread";

export const BANDS: Record<Band, { name: string; meaning: string }> = {
  ready: { name: "Ready", meaning: "You can show evidence for everything it requires." },
  by_date: { name: "On your plan", meaning: "Everything it requires is either evidenced or coming in your plan." },
  one_gap: { name: "One gap", meaning: "One requirement is neither evidenced nor in your plan." },
  stretch: { name: "Stretch", meaning: "Two or more requirements are neither evidenced nor in your plan." },
  unread: {
    name: "Too little to judge",
    meaning: "Too few skills on your list were found in the advert to say how close you are.",
  },
};

export type RequirementView = {
  skill: string;
  name: string;
  level: RequirementLevel;
  quote: string;
  status: SkillStatus;
  standing: Standing;
  /** Others in the same "any of" group, by name. */
  orElse: string[];
};

export type Fit = {
  band: Band;
  must: RequirementView[];
  soft: RequirementView[];
  /** Must-have skills, grouped alternatives as one, that you cannot cover. */
  gaps: string[];
  coming: { name: string; dueOn: string | null; phase: number | null }[];
  showing: string[];
  /** The last date a planned must-have arrives, when every one has a date. */
  readyBy: string | null;
  /** How many specialist skills it asks for that you have or are learning. Ranks closeness. */
  specialist: number;
  reason: string;
};

const STATUS_RANK: Record<SkillStatus, number> = { evidenced: 3, in_plan: 2, near: 1, missing: 0 };

/**
 * Below this, a match says more about how little was recognised than about you: an
 * advert where only "Python" was understood is not a role you are ready for.
 */
const MIN_MUST_GROUPS = 2;
const MIN_ALL_REQUIREMENTS = 3;

/** Fit is decided by the worst must-have, not an average, so one real gap is never hidden. */
export function roleFit(requirements: readonly Requirement[], standings: ReadonlyMap<string, Standing>): Fit {
  const views: RequirementView[] = requirements.flatMap((r) => {
    const standing = standings.get(r.skill);
    if (!standing) return [];
    const orElse = requirements
      .filter((o) => o.group === r.group && o.skill !== r.skill)
      .map((o) => skillByKey(o.skill)?.name ?? o.skill);
    return [
      {
        skill: r.skill,
        name: standing.name,
        level: r.level,
        quote: r.quote,
        status: standing.status,
        standing,
        orElse,
      },
    ];
  });
  const must = views.filter((v) => v.level === "required" || v.level === "unstated");
  const soft = views.filter((v) => v.level === "preferred" || v.level === "responsibility");

  // Alternatives count as one requirement, met by the best of them.
  const groups = new Map<number, RequirementView[]>();
  requirements.forEach((r) => {
    const view = must.find((v) => v.skill === r.skill);
    if (view) groups.set(r.group, [...(groups.get(r.group) ?? []), view]);
  });
  const bestOf = [...groups.values()].map(
    (g) => [...g].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0],
  );

  const gaps = bestOf.filter((v) => v.status === "near" || v.status === "missing").map((v) => v.name);
  const planned = bestOf.filter((v) => v.status === "in_plan");
  const coming = planned.map((v) => ({
    name: v.name,
    dueOn: v.standing.next?.dueOn ?? null,
    phase: v.standing.next?.phase ?? null,
  }));
  const showing = bestOf.filter((v) => v.status === "evidenced").map((v) => v.name);
  const dates = coming.map((c) => c.dueOn);
  const readyBy = dates.length && dates.every(Boolean) ? (dates as string[]).sort().at(-1)! : null;

  const softGaps = soft.filter((v) => v.status === "near" || v.status === "missing").map((v) => v.name);
  const specialist = views.filter(
    (v) => skillByKey(v.skill)?.core && (v.status === "evidenced" || v.status === "in_plan"),
  ).length;
  const enough = bestOf.length >= MIN_MUST_GROUPS && bestOf.length + soft.length >= MIN_ALL_REQUIREMENTS;

  let band: Band;
  if (gaps.length >= 2) band = "stretch";
  else if (!enough) band = "unread";
  else if (gaps.length === 1) band = "one_gap";
  else if (planned.length) band = "by_date";
  else band = "ready";

  return {
    band,
    must,
    soft,
    gaps,
    coming,
    showing,
    readyBy,
    specialist,
    reason: reasonFor({ band, gaps, coming, showing, softGaps, recognised: views.map((v) => v.name) }),
  };
}

const list = (names: string[], max = 3) => {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
  return extra > 0 ? `${joined} and ${extra} more` : joined;
};

function reasonFor({
  band,
  gaps,
  coming,
  showing,
  softGaps,
  recognised,
}: {
  band: Band;
  gaps: string[];
  coming: Fit["coming"];
  showing: string[];
  softGaps: string[];
  recognised: string[];
}): string {
  if (band === "unread") {
    return recognised.length
      ? `Only ${list(recognised)} from your skill list ${recognised.length === 1 ? "appears" : "appear"} in this advert, which is too little to judge it. Read the advert.`
      : "No advert on file, or nothing in it is on your skill list.";
  }
  const parts: string[] = [];
  if (showing.length) parts.push(`You can show ${list(showing)}.`);
  if (coming.length)
    parts.push(`${list(coming.map((c) => c.name))} ${coming.length === 1 ? "is" : "are"} coming in your plan.`);
  if (gaps.length) parts.push(`Not in your plan: ${list(gaps)}.`);
  if (softGaps.length && band !== "stretch") parts.push(`Also wanted, and not in your plan: ${list(softGaps, 2)}.`);
  if (!parts.length) parts.push("Its requirements are not ones you can show yet.");
  return parts.join(" ");
}

export type RoleInput = {
  gid: string;
  title: string;
  company: string;
  family: string;
  seniority: Seniority;
  location_tier: string;
  requirements: Requirement[];
  details: Details;
  closed_at: string | null;
  interest: number | null;
  stage: string;
};

/** The roles shown by default. Abroad has to be a real match, and so does general software. */
export function isVisible(role: RoleInput, fit: Fit): boolean {
  if (role.stage !== "new" || (role.interest ?? 0) >= 2) return true;
  const strong = fit.band === "ready" || fit.band === "by_date";
  if (role.location_tier === "abroad")
    return strong && isCoreFamily(role.family) && role.seniority !== "lead" && role.seniority !== "senior";
  if (!isCoreFamily(role.family)) return strong || fit.band === "one_gap";
  return true;
}

/** What counts as the market you care about: open roles you have not ruled out. */
export function isTarget(role: RoleInput, fit: Fit): boolean {
  if (role.closed_at || role.stage === "passed" || role.interest === 0) return false;
  return isVisible(role, fit);
}

/** How much a role counts: more if you marked it, less if you have not looked yet. */
const weightOf = (role: Pick<RoleInput, "interest">) => (role.interest === null ? 1 : Math.max(role.interest, 1));

export type MarketRow = {
  skill: Skill;
  standing: Standing;
  must: number;
  soft: number;
  /** Must-have demand weighted by interest, times how far you are from it. */
  priority: number;
  roles: { gid: string; title: string; company: string }[];
};

const DISTANCE: Record<SkillStatus, number> = { evidenced: 0, in_plan: 0.25, near: 0.5, missing: 1 };

export function marketRows(roles: readonly RoleInput[], standings: ReadonlyMap<string, Standing>): MarketRow[] {
  const rows = new Map<string, MarketRow & { weight: number }>();
  for (const role of roles) {
    for (const r of role.requirements) {
      const standing = standings.get(r.skill);
      const skill = skillByKey(r.skill);
      if (!standing || !skill) continue;
      const row = rows.get(r.skill) ?? { skill, standing, must: 0, soft: 0, priority: 0, roles: [], weight: 0 };
      if (r.level === "required" || r.level === "unstated") {
        row.must++;
        row.weight += weightOf(role);
      } else {
        row.soft++;
        row.weight += weightOf(role) * 0.25;
      }
      row.roles.push({ gid: role.gid, title: role.title, company: role.company });
      rows.set(r.skill, row);
    }
  }
  return [...rows.values()]
    .map(({ weight, ...row }) => ({ ...row, priority: Math.round(weight * DISTANCE[row.standing.status] * 100) / 100 }))
    .sort((a, b) => b.priority - a.priority || b.must - a.must || b.soft - a.soft);
}

const BAND_RANK: Record<Band, number> = { ready: 4, by_date: 3, one_gap: 2, stretch: 1, unread: 0 };

/** For each way the plan could go next, how many roles it matters to and how many it moves up. */
export function branchImpact(roles: readonly RoleInput[], standings: ReadonlyMap<string, Standing>) {
  return BRANCHES.map((branch) => {
    const set = new Set(branch.skills);
    const improved = new Map(standings);
    for (const key of branch.skills) {
      const current = standings.get(key);
      if (current) improved.set(key, { ...current, status: "evidenced", level: Math.max(current.level, 2) });
    }
    let asking = 0;
    let askingWanted = 0;
    let unlocks = 0;
    for (const role of roles) {
      const relevant = role.requirements.some((r) => set.has(r.skill) && r.level !== "responsibility");
      if (!relevant) continue;
      asking++;
      if ((role.interest ?? 0) >= 2) askingWanted++;
      if (BAND_RANK[roleFit(role.requirements, improved).band] > BAND_RANK[roleFit(role.requirements, standings).band])
        unlocks++;
    }
    return { ...branch, asking, askingWanted, unlocks };
  });
}

/** Capitalised terms that adverts keep requiring and the skill list does not know. */
export function unknownTerms(roles: readonly RoleInput[], min = 2): { term: string; roles: number }[] {
  const counts = new Map<string, number>();
  for (const role of roles) {
    for (const t of role.details.unknownTerms ?? []) {
      // An employer's own name is not a skill, wherever it appears in its advert.
      if (t.toLowerCase() !== role.company.toLowerCase()) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([term, n]) => ({ term, roles: n }));
}
