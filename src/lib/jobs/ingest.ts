// Turns what a feed said into a row to store, and decides what is worth storing.

import {
  advertText,
  EXTRACT_VERSION,
  extractRequirements,
  seniorityOf,
  type Details,
  type Requirement,
  type Seniority,
} from "./extract.ts";
import { familyOf, isCoreFamily, locationTier, type LocationTier } from "./classify.ts";
import type { RawJob } from "./feeds.ts";
import { skillByKey } from "./skills.ts";

export type PostingRow = {
  source_job_id: string;
  title: string;
  company: string;
  location: string;
  location_tier: LocationTier;
  url: string | null;
  posted_on: string | null;
  salary: string | null;
  family: string;
  seniority: Seniority;
  body: string;
  requirements: Requirement[];
  details: Details;
  extract_version: number;
};

/** Feeds of every employer, as opposed to employers you chose. */
const DISCOVERY = new Set(["arbeitnow"]);
/** Fields specific enough that the title alone makes a role from a general feed worth a look. */
const SPECIFIC_FAMILIES = new Set(["graphics", "gpu", "vision", "simulation", "xr", "research"]);
/** Almost every "AI" job names these, so they say nothing about your specialism. */
const TOO_GENERAL = new Set(["machine-learning", "llm"]);

/** Reads one advert's text. Also used to re-read stored adverts when the rules change. */
export function readAdvert(title: string, body: string) {
  const { requirements, details } = extractRequirements(body);
  return {
    family: familyOf(title) ?? "software",
    seniority: seniorityOf(title, body),
    requirements,
    details,
    extract_version: EXTRACT_VERSION,
  };
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The names an employer you already follow might appear under in a general feed. */
export function followedNames(sources: readonly { kind: string; token: string; name: string }[]): Set<string> {
  return new Set(
    sources
      .filter((s) => !DISCOVERY.has(s.kind) && s.kind !== "rse" && s.kind !== "manual")
      .flatMap((s) => [squash(s.token), squash(s.name)]),
  );
}

/** A role to keep, or null. An employer you chose gets more benefit of the doubt. */
export function toPosting(job: RawJob, kind: string, followed: ReadonlySet<string> = new Set()): PostingRow | null {
  // Roles at employers you follow come from their own board, with better data.
  if (DISCOVERY.has(kind) && followed.has(squash(job.company))) return null;
  const family = familyOf(job.title);
  if (!family && kind !== "rse") return null;
  const tier = locationTier(job.locations, job.remote);
  const resolved = family ?? "research";
  if (tier === "abroad" && !isCoreFamily(resolved)) return null;

  const body = job.content ? advertText(job.content) : "";
  const read = readAdvert(job.title, body);

  // Most of a general feed is nothing to do with you. A role stays if its title is in
  // your fields, or if its advert requires at least two specialist skills.
  if (DISCOVERY.has(kind)) {
    const specialist = read.requirements.filter(
      (r) =>
        skillByKey(r.skill)?.core && !TOO_GENERAL.has(r.skill) && (r.level === "required" || r.level === "unstated"),
    ).length;
    if (!SPECIFIC_FAMILIES.has(resolved) && specialist < 2) return null;
    if (tier === "abroad" || tier === "unknown") return null;
  }

  return {
    source_job_id: job.id,
    title: job.title.slice(0, 300),
    company: job.company.slice(0, 200),
    location: job.locations
      .map((l) =>
        l
          .replace(/\s*\n\s*/g, ", ")
          .replace(/\bBLANK,\s*/g, "")
          .trim(),
      )
      .filter(Boolean)
      .join("; ")
      .slice(0, 500),
    location_tier: tier,
    url: job.url,
    posted_on: job.postedOn,
    salary: job.salary?.slice(0, 200) ?? null,
    family: resolved,
    seniority: read.seniority,
    body,
    requirements: read.requirements,
    details: read.details,
    extract_version: read.extract_version,
  };
}
