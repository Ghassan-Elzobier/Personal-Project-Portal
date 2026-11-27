// Client projects: software the owner builds for other people. They sit in the
// Work space but belong to the owner alone, like Life: none of it becomes a task,
// so mentors never see it. Pure, so it is tested with node's test runner. The
// database is ./store.ts, every change is ./operations.ts, and Claude's tools
// are ./connector.ts.

/** A project's stages, in the order work moves through them. */
export const STAGES = ["lead", "scoping", "agreed", "building", "handed_over", "support", "closed"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  lead: "Lead",
  scoping: "Scoping",
  agreed: "Agreed",
  building: "Building",
  handed_over: "Handed over",
  support: "Support",
  closed: "Closed",
};

export const PRICINGS = ["fixed", "day_rate", "unpaid"] as const;
export type Pricing = (typeof PRICINGS)[number];
export const PRICING_LABELS: Record<Pricing, string> = {
  fixed: "Fixed price",
  day_rate: "Day rate",
  unpaid: "Unpaid",
};

export const RELATIONSHIPS = ["family", "friend", "referral", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  family: "Family",
  friend: "Friend",
  referral: "Referral",
  other: "Other",
};

/** The limits the database checks (20261127091600_clients.sql). */
export const NAME_MAX = 120;
export const TITLE_MAX = 120;
export const MILESTONE_MAX = 200;
export const CHANNEL_MAX = 80;
export const NOTES_MAX = 2000;
const URL_MAX = 300;
const AMOUNT_MAX_PENCE = 100_000_000;

export type Client = {
  gid: string;
  name: string;
  relationship: Relationship;
  channel: string | null;
  timeZone: string | null;
  notes: string | null;
};

export type ClientProject = {
  gid: string;
  clientGid: string;
  title: string;
  stage: Stage;
  pricing: Pricing;
  repoUrl: string | null;
  previewUrl: string | null;
  liveUrl: string | null;
  notes: string | null;
};

export type Milestone = {
  gid: string;
  projectGid: string;
  title: string;
  dueOn: string | null;
  amountPence: number | null;
  acceptedOn: string | null;
  paidOn: string | null;
};

export type ClientsData = { clients: Client[]; projects: ClientProject[]; milestones: Milestone[] };

export type Money = {
  /** Every milestone's amount added up. */
  agreedPence: number;
  paidPence: number;
  /** Accepted by the client but not paid yet. */
  owedPence: number;
};

export type ProjectView = ClientProject & Money & { milestones: Milestone[]; next: Milestone | null };
export type ClientView = Client & { projects: ProjectView[] };

const oneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

export const isStage = oneOf(STAGES);
export const isPricing = oneOf(PRICINGS);
export const isRelationship = oneOf(RELATIONSHIPS);

// Soonest first, undated last, then in the order they were added.
const byDue = (a: Milestone, b: Milestone) =>
  (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || Number(a.gid) - Number(b.gid);

/** The next thing to deliver: the soonest milestone the client has not accepted yet. */
export function nextMilestone(milestones: readonly Milestone[]): Milestone | null {
  return milestones.filter((m) => m.acceptedOn === null).sort(byDue)[0] ?? null;
}

/** What a project's milestones add up to: agreed in all, paid, and accepted but not yet paid. */
export function money(milestones: readonly Milestone[]): Money {
  const total: Money = { agreedPence: 0, paidPence: 0, owedPence: 0 };
  for (const m of milestones) {
    const amount = m.amountPence ?? 0;
    total.agreedPence += amount;
    if (m.paidOn) total.paidPence += amount;
    else if (m.acceptedOn) total.owedPence += amount;
  }
  return total;
}

const isLive = (p: { stage: Stage }) => p.stage !== "closed";

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/**
 * Each client with its projects, and each project with its milestones, next
 * milestone and money. Live projects come first in stage order, closed ones last;
 * clients with a live project come before those without, then by name.
 */
export function clientTree(data: ClientsData): ClientView[] {
  const milestones = groupBy(data.milestones, (m) => m.projectGid);
  const projects = groupBy(data.projects, (p) => p.clientGid);
  const tree = data.clients.map((c) => ({
    ...c,
    projects: (projects.get(c.gid) ?? [])
      .map((p) => {
        const own = [...(milestones.get(p.gid) ?? [])].sort(byDue);
        return { ...p, milestones: own, next: nextMilestone(own), ...money(own) };
      })
      .sort(
        (a, b) =>
          Number(isLive(b)) - Number(isLive(a)) ||
          STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) ||
          Number(a.gid) - Number(b.gid),
      ),
  }));
  const hasLive = (c: ClientView) => c.projects.some(isLive);
  return tree.sort((a, b) => Number(hasLive(b)) - Number(hasLive(a)) || a.name.localeCompare(b.name));
}

export type Summary = {
  liveProjects: number;
  owedPence: number;
  /** The soonest milestone not yet accepted across every live project. */
  next: { client: string; project: string; milestone: Milestone } | null;
};

/** The page's headline: projects in progress, money owed, and what is due next. */
export function summary(tree: readonly ClientView[]): Summary {
  const live = tree.flatMap((c) => c.projects.filter(isLive).map((p) => ({ client: c.name, project: p })));
  const next = live
    .filter((x) => x.project.next !== null)
    .map((x) => ({ client: x.client, project: x.project.title, milestone: x.project.next! }))
    .sort((a, b) => byDue(a.milestone, b.milestone))[0];
  return {
    liveProjects: live.length,
    owedPence: tree.reduce((s, c) => s + c.projects.reduce((t, p) => t + p.owedPence, 0), 0),
    next: next ?? null,
  };
}

/** Trimmed text of 1 to `max` characters, or null when there is none or it is too long. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

/**
 * A field that may be left empty: blank text means none (null). Undefined when
 * the value cannot be saved (not text, or too long).
 */
export function cleanOptional(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return null;
  return text.length <= max ? text : undefined;
}

/** An https link, or null for none. Undefined when it is not one the database takes. */
export function cleanUrl(value: unknown): string | null | undefined {
  const text = cleanOptional(value, URL_MAX);
  if (text === null || text === undefined) return text;
  return /^https:\/\/\S+$/.test(text) ? text : undefined;
}

/** A real day, written YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A time zone the browser and the server both know, such as "Europe/Paris". */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A whole number of pence the database takes. */
export function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= AMOUNT_MAX_PENCE;
}

/**
 * An amount typed in pounds ("1500", "1,500.50", "£250") as pence. Blank means
 * none (null); undefined when it is not an amount.
 */
export function parsePounds(text: string): number | null | undefined {
  const clean = text.replace(/[\s£,]/g, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return undefined;
  const pence = Math.round(Number(clean) * 100);
  return isAmount(pence) ? pence : undefined;
}
