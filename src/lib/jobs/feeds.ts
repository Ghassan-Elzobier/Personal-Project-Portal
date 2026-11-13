// Reads the job feeds this tracker is allowed to read. Each URL is built here from a
// source's kind and a checked token, so nothing in the database or in an advert can
// point a request anywhere else.
//
// Documented feeds only. Workday, Oracle, SmartRecruiters and sites whose terms bar
// automation (LinkedIn, Indeed, Glassdoor, Apple) are not here and should stay out.

import { advertText, decodeEntities } from "./extract.ts";
import { familyOf, isCoreFamily, locationTier } from "./classify.ts";

export type SourceKind = "greenhouse" | "ashby" | "lever" | "workable" | "teamtailor" | "arbeitnow" | "rse";
export const FEED_KINDS: readonly SourceKind[] = [
  "greenhouse",
  "ashby",
  "lever",
  "workable",
  "teamtailor",
  "arbeitnow",
  "rse",
];

export type RawJob = {
  id: string;
  title: string;
  company: string;
  locations: string[];
  remote: boolean;
  url: string | null;
  postedOn: string | null;
  salary: string | null;
  /** Advert HTML or plain text. Null when a feed lists a role without it. */
  content: string | null;
};

export type FeedRead = {
  ok: boolean;
  error: string | null;
  /** Every id in the feed, or null if the read was partial and must close nothing. */
  seen: string[] | null;
  jobs: RawJob[];
};

type Fetcher = typeof fetch;

const HEADERS = {
  "User-Agent": "personal-job-tracker",
  Accept: "application/json, application/rss+xml, text/xml;q=0.9, */*;q=0.5",
};
const TIMEOUT_MS = 60000;
const MAX_BYTES = 40 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_.-]{1,120}$/;
/** Feeds that need a request per role get a limit per read. The rest come next time. */
const MAX_DETAILS = 40;

export class FeedError extends Error {}

async function get(url: string, fetcher: Fetcher): Promise<string> {
  // A redirect could leave the hosts this file chooses, so none are followed.
  const res = await fetcher(url, {
    headers: HEADERS,
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new FeedError(`The feed answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new FeedError("The feed was too large to read.");
  return text;
}

async function getJson<T>(url: string, fetcher: Fetcher): Promise<T> {
  const text = await get(url, fetcher);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FeedError("The feed did not return readable data.");
  }
}

const dateOf = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const safeUrl = (value: unknown): string | null =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a role is worth fetching in full, from what a list tells us. */
export function worthKeeping(title: string, locations: string[], remote: boolean): boolean {
  const family = familyOf(title);
  if (!family) return false;
  const tier = locationTier(locations, remote);
  return tier !== "abroad" || isCoreFamily(family);
}

async function readGreenhouse(
  token: string,
  name: string,
  known: ReadonlySet<string>,
  fetcher: Fetcher,
): Promise<FeedRead> {
  type Item = {
    id: number;
    title: string;
    location?: { name?: string };
    absolute_url?: string;
    first_published?: string;
    updated_at?: string;
    content?: string;
  };
  const base = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`;
  const list = await getJson<{ jobs?: Item[] }>(base, fetcher);
  const items = list.jobs ?? [];
  const toJob = (j: Item, content: string | null): RawJob => ({
    id: String(j.id),
    title: j.title,
    company: name,
    locations: [j.location?.name ?? ""],
    remote: false,
    url: safeUrl(j.absolute_url),
    postedOn: dateOf(j.first_published ?? j.updated_at),
    salary: null,
    content,
  });

  const jobs: RawJob[] = [];
  let details = 0;
  let partial = false;
  for (const item of items) {
    if (!worthKeeping(item.title, [item.location?.name ?? ""], false)) continue;
    if (known.has(String(item.id))) {
      jobs.push(toJob(item, null));
      continue;
    }
    if (details >= MAX_DETAILS) {
      jobs.push(toJob(item, null));
      partial = true;
      continue;
    }
    details++;
    try {
      const full = await getJson<Item>(`${base}/${item.id}`, fetcher);
      jobs.push(toJob(item, full.content ?? ""));
    } catch {
      jobs.push(toJob(item, null));
      partial = true;
    }
    await pause(250);
  }
  return {
    ok: true,
    error: partial ? "Some adverts were not fetched this time. The rest come next refresh." : null,
    seen: items.map((j) => String(j.id)),
    jobs,
  };
}

async function readAshby(token: string, name: string, fetcher: Fetcher): Promise<FeedRead> {
  type Item = {
    id: string;
    title: string;
    location?: string;
    secondaryLocations?: { location?: string }[];
    isRemote?: boolean;
    isListed?: boolean;
    publishedAt?: string;
    jobUrl?: string;
    descriptionHtml?: string;
    descriptionPlain?: string;
    compensation?: { compensationTierSummary?: string };
  };
  const data = await getJson<{ jobs?: Item[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`,
    fetcher,
  );
  const items = (data.jobs ?? []).filter((j) => j.isListed !== false);
  return {
    ok: true,
    error: null,
    seen: items.map((j) => j.id),
    jobs: items.map((j) => ({
      id: j.id,
      title: j.title,
      company: name,
      locations: [j.location ?? "", ...(j.secondaryLocations ?? []).map((l) => l.location ?? "")].filter(Boolean),
      remote: j.isRemote ?? false,
      url: safeUrl(j.jobUrl),
      postedOn: dateOf(j.publishedAt),
      salary: j.compensation?.compensationTierSummary ?? null,
      content: j.descriptionHtml ?? j.descriptionPlain ?? "",
    })),
  };
}

async function readLever(token: string, name: string, fetcher: Fetcher): Promise<FeedRead> {
  type Item = {
    id: string;
    text: string;
    categories?: { location?: string; allLocations?: string[] };
    country?: string;
    workplaceType?: string;
    hostedUrl?: string;
    createdAt?: number;
    description?: string;
    descriptionPlain?: string;
    lists?: { text?: string; content?: string }[];
    additional?: string;
    additionalPlain?: string;
    salaryRange?: { min?: number; max?: number; currency?: string };
  };
  const items = await getJson<Item[]>(`https://api.lever.co/v0/postings/${token}?mode=json`, fetcher);
  return {
    ok: true,
    error: null,
    seen: items.map((j) => j.id),
    jobs: items.map((j) => ({
      id: j.id,
      title: j.text,
      company: name,
      // "Remote" means little without its country, and a US company's remote is not yours.
      locations: [...new Set([...(j.categories?.allLocations ?? []), j.categories?.location ?? ""])]
        .filter(Boolean)
        .map((l) => (/remote/i.test(l) && j.country ? `${l}, ${j.country}` : l)),
      remote: j.workplaceType === "remote",
      url: safeUrl(j.hostedUrl),
      postedOn: dateOf(j.createdAt),
      salary: j.salaryRange?.min
        ? `${j.salaryRange.currency ?? ""} ${j.salaryRange.min} to ${j.salaryRange.max ?? ""}`.trim()
        : null,
      // Lever keeps its sections apart, so each gets its heading back.
      content: [
        j.description ?? j.descriptionPlain ?? "",
        ...(j.lists ?? []).map((l) => `<h3>${l.text ?? ""}</h3><ul>${l.content ?? ""}</ul>`),
        j.additional ?? j.additionalPlain ?? "",
      ].join("\n"),
    })),
  };
}

async function readWorkable(token: string, name: string, fetcher: Fetcher): Promise<FeedRead> {
  type Item = {
    shortcode: string;
    title: string;
    city?: string;
    state?: string;
    country?: string;
    telecommuting?: boolean;
    url?: string;
    application_url?: string;
    published_on?: string;
    created_at?: string;
    description?: string;
  };
  const data = await getJson<{ jobs?: Item[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`,
    fetcher,
  );
  const items = data.jobs ?? [];
  return {
    ok: true,
    error: null,
    seen: items.map((j) => j.shortcode),
    jobs: items.map((j) => ({
      id: j.shortcode,
      title: j.title,
      company: name,
      locations: [[j.city, j.state, j.country].filter(Boolean).join(", ")],
      remote: j.telecommuting ?? false,
      url: safeUrl(j.url ?? j.application_url),
      postedOn: dateOf(j.published_on ?? j.created_at),
      salary: null,
      content: j.description ?? "",
    })),
  };
}

/** The items of an RSS feed, with CDATA unwrapped. Only named tags are ever read. */
export function rssItems(xml: string): ((tag: string) => string)[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => (tag: string) => {
    const found = new RegExp(
      `<${tag.replace(":", "\\:")}\\b[^>]*>([\\s\\S]*?)<\\/${tag.replace(":", "\\:")}>`,
      "i",
    ).exec(m[1]);
    if (!found) return "";
    const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(found[1]);
    return cdata ? cdata[1] : decodeEntities(found[1]);
  });
}

async function readTeamtailor(token: string, name: string, fetcher: Fetcher): Promise<FeedRead> {
  const items = rssItems(await get(`https://${token}.teamtailor.com/jobs.rss?per_page=200`, fetcher));
  const jobs = items.map((tag): RawJob => {
    const link = tag("link").trim();
    return {
      id: tag("guid").trim() || link,
      title: advertText(tag("title")),
      company: name,
      locations: [
        tag("tt:location") || [tag("tt:city"), tag("tt:country")].filter(Boolean).join(", ") || tag("location"),
      ].map((l) => advertText(l)),
      remote: /remote/i.test(tag("remote") + tag("tt:remote-status")),
      url: safeUrl(link),
      postedOn: dateOf(tag("pubDate")),
      salary: null,
      content: tag("content:encoded") || tag("description"),
    };
  });
  return { ok: true, error: null, seen: jobs.map((j) => j.id), jobs };
}

async function readRse(fetcher: Fetcher): Promise<FeedRead> {
  const items = rssItems(await get("https://society-rse.org/?feed=job_feed", fetcher));
  const jobs = items.map((tag): RawJob => {
    const link = tag("link").trim();
    return {
      id: tag("guid").trim() || link,
      title: advertText(tag("title")),
      company: advertText(tag("job_listing:company")) || "Research Software Engineering",
      locations: [advertText(tag("job_listing:location"))],
      remote: false,
      url: safeUrl(link),
      postedOn: dateOf(tag("pubDate")),
      salary: null,
      content: tag("content:encoded") || tag("description"),
    };
  });
  return { ok: true, error: null, seen: jobs.map((j) => j.id), jobs };
}

const ARBEITNOW_PAGES = 15;

async function readArbeitnow(fetcher: Fetcher): Promise<FeedRead> {
  type Item = {
    slug: string;
    company_name?: string;
    title: string;
    description?: string;
    remote?: boolean;
    url?: string;
    location?: string;
    created_at?: number;
  };
  const jobs: RawJob[] = [];
  let partial = false;
  for (let page = 1; page <= ARBEITNOW_PAGES; page++) {
    let data: { data?: Item[]; links?: { next?: string | null } };
    try {
      data = await getJson(`https://www.arbeitnow.co.uk/api/job-board-api?page=${page}`, fetcher);
    } catch (err) {
      if (page === 1) throw err;
      partial = true;
      break;
    }
    const items = data.data ?? [];
    for (const j of items) {
      jobs.push({
        id: j.slug,
        title: j.title,
        company: j.company_name ?? "Unknown employer",
        locations: [j.location ?? ""],
        remote: j.remote ?? false,
        url: safeUrl(j.url),
        postedOn: dateOf(j.created_at),
        salary: null,
        content: j.description ?? "",
      });
    }
    if (!items.length || !data.links?.next) break;
    await pause(1000);
  }
  return {
    ok: true,
    error: partial ? "Only part of the feed was read this time." : null,
    seen: partial ? null : jobs.map((j) => j.id),
    jobs,
  };
}

/** Works out a feed from any job link at an employer, so adding one takes a paste. */
export function parseBoardLink(link: string): { kind: SourceKind; token: string } | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  const named = (kind: SourceKind, token: string) => (TOKEN.test(token) ? { kind, token } : null);
  if (
    host === "job-boards.greenhouse.io" ||
    host === "boards.greenhouse.io" ||
    host === "job-boards.eu.greenhouse.io" ||
    host === "boards.eu.greenhouse.io"
  )
    return named("greenhouse", first);
  if (host === "jobs.ashbyhq.com") return named("ashby", first);
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return named("lever", first);
  if (host === "apply.workable.com") return named("workable", first);
  const teamtailor = /^([a-z0-9-]+)\.teamtailor\.com$/.exec(host);
  if (teamtailor) return named("teamtailor", teamtailor[1]);
  return null;
}

/** Reads one source. Never throws: a failed read is a result, and closes nothing. */
export async function readFeed(
  source: { kind: string; token: string; name: string },
  known: ReadonlySet<string> = new Set(),
  fetcher: Fetcher = fetch,
): Promise<FeedRead> {
  try {
    if (!TOKEN.test(source.token)) throw new FeedError("That board name is not valid.");
    switch (source.kind as SourceKind) {
      case "greenhouse":
        return await readGreenhouse(source.token, source.name, known, fetcher);
      case "ashby":
        return await readAshby(source.token, source.name, fetcher);
      case "lever":
        return await readLever(source.token, source.name, fetcher);
      case "workable":
        return await readWorkable(source.token, source.name, fetcher);
      case "teamtailor":
        return await readTeamtailor(source.token, source.name, fetcher);
      case "arbeitnow":
        return await readArbeitnow(fetcher);
      case "rse":
        return await readRse(fetcher);
      default:
        throw new FeedError("That kind of source has no feed.");
    }
  } catch (err) {
    const message =
      err instanceof FeedError
        ? err.message
        : err instanceof Error && err.name === "TimeoutError"
          ? "The feed took too long to answer."
          : "Could not reach the feed.";
    return { ok: false, error: message, seen: null, jobs: [] };
  }
}
