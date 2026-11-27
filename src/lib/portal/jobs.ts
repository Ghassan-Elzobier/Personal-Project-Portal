import "server-only";
import { revalidatePath } from "next/cache";
import { askClaude, claudeReady } from "../ai/claude";
import { AiError, aiProblem } from "../ai/messages";
import { jobPagesTestOrigin, timeZone } from "../config/env";
import { now } from "../dates/clock";
import { dateIn, isDay } from "../dates/week";
import { advertAsk, readAdvertAnswer, type AdvertReading } from "../jobs/ai-read";
import { CLAUDE_READ_VERSION, needsClaude, readRequirementsAnswer, requirementsAsk } from "../jobs/ai-requirements";
import { boardOf, careersAsk, careersJobs, pageLinks, readCareersAnswer } from "../jobs/careers-read";
import { familyOf, locationTier } from "../jobs/classify";
import { advertText, EXTRACT_VERSION, seniorityOf, type Requirement } from "../jobs/extract";
import { FEED_KINDS, parseBoardLink, readFeed, type FeedRead } from "../jobs/feeds";
import { followedNames, readAdvert, toPosting } from "../jobs/ingest";
import { fetchJobPage, PageError, pageText, type PageReason } from "../jobs/job-page";
import { applyBy } from "../jobs/next-step";
import { postingData, type PostingData } from "../jobs/posting-data";
import { skillByKey } from "../jobs/skills";
import * as store from "../jobs/store";

// Every change the job tracker makes. Pages and buttons call these; nothing here is
// reachable from the Claude connector.

export type OpResult = { error?: string };

const STAGES = new Set(["new", "saved", "applied", "interview", "offer", "rejected", "passed"]);
const httpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

function fail(err: unknown, fallback: string): OpResult {
  return { error: err instanceof Error && err.message ? err.message : fallback };
}

function refreshPages() {
  revalidatePath("/jobs");
  revalidatePath("/study");
  revalidatePath("/");
}

export type RefreshResult = OpResult & { read?: number; added?: number; closed?: number; failed?: string[] };

let running: Promise<RefreshResult> | null = null;

/** Reads every active feed, a few at a time. A second press joins the run under way. */
export function refreshJobs(): Promise<RefreshResult> {
  running ??= runRefresh().finally(() => {
    running = null;
  });
  return running;
}

/** What the row of a careers page says when the portal could not read it this time. */
const CAREERS_PROBLEM: Partial<Record<PageReason, string>> = {
  browser: "This page builds itself in the browser, so the portal can't read it. Check it by hand.",
  barred: "This site's terms don't allow reading it automatically. Check it by hand.",
  refused: "This site wouldn't let the portal read the page. Check it by hand.",
  gone: "This page has gone. Follow the employer's new careers page.",
};

/**
 * A careers page on the hand list, read as a feed (careers-read.ts): through the job board
 * it is built on when it has one, which is free, and otherwise by Claude. A read that
 * fails closes nothing and leaves the page to be checked by hand, with the reason.
 */
async function readCareersPage(source: store.JobSource): Promise<FeedRead> {
  const failed = (error: string): FeedRead => ({ ok: false, error, seen: null, jobs: [] });
  try {
    const page = await fetchJobPage(source.careers_url ?? "", fetch, undefined, jobPagesTestOrigin());
    const board = boardOf(page.html, page.url);
    if (board) {
      const known = board.kind === "greenhouse" ? new Set(await store.knownIds(source.gid)) : new Set<string>();
      const read = await readFeed({ ...board, name: source.name }, known);
      return read.ok ? read : failed(`Its job board didn't answer: ${read.error ?? "try again later."}`);
    }
    if (!claudeReady()) return failed("Reading this page needs the Claude API key, so check it by hand.");
    const links = pageLinks(page.html, page.url);
    const answer = readCareersAnswer(await askClaude(careersAsk(pageText(page.html), links)), links);
    if (!answer) return failed("Claude couldn't read this page this time. Check it by hand if it keeps failing.");
    if (!answer.isCareersPage) return failed("This page doesn't list roles. Follow the employer's jobs page instead.");
    const jobs = careersJobs(answer.roles, source.name);
    return { ok: true, error: null, seen: jobs.map((j) => j.id), jobs };
  } catch (err) {
    if (err instanceof PageError)
      return failed(
        CAREERS_PROBLEM[err.reason] ?? "Couldn't read this page this time. Check it by hand if it keeps failing.",
      );
    if (err instanceof AiError) {
      console.error("claude", err.code);
      return failed(
        err.code === "NO_CREDIT"
          ? "This month's Claude API credit is spent, so check this page by hand until it renews."
          : "Claude couldn't read this page this time. Check it by hand if it keeps failing.",
      );
    }
    return failed("Couldn't read this page this time. Check it by hand if it keeps failing.");
  }
}

async function runRefresh(): Promise<RefreshResult> {
  try {
    const all = await store.listSources();
    const followed = followedNames(all);
    const sources = all.filter(
      (s) => s.active && ((FEED_KINDS as readonly string[]).includes(s.kind) || (s.kind === "link" && s.careers_url)),
    );
    let added = 0;
    let closed = 0;
    const failed: string[] = [];

    const queue = [...sources];
    const worker = async () => {
      for (let source = queue.shift(); source; source = queue.shift()) {
        const page = source.kind === "link";
        const known = source.kind === "greenhouse" ? new Set(await store.knownIds(source.gid)) : new Set<string>();
        const read = page ? await readCareersPage(source) : await readFeed(source, known);
        const postings = read.jobs.flatMap((job) => toPosting(job, source!.kind, followed) ?? []);
        const saved = await store.saveRead(source.gid, read, postings);
        added += saved.added;
        closed += saved.closed;
        // A careers page that can't be read says why on its own row, so it isn't news each time.
        if (!read.ok && !page) failed.push(source.name);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    await rereadOldAdverts();
    await readWeakAdverts();
    refreshPages();
    return { read: sources.length, added, closed, failed };
  } catch (err) {
    return fail(err, "Could not read the feeds.");
  }
}

/** How many weak adverts from the feeds each check hands to Claude; the rest wait for the next. */
const CLAUDE_READS_PER_CHECK = 8;

/** Claude's checked reading of an advert's requirements, or null if it couldn't give one. Throws AiError. */
async function claudeRequirements(body: string, rules: Requirement[]): Promise<Requirement[] | null> {
  return readRequirementsAnswer(await askClaude(requirementsAsk(body)), body, rules);
}

/**
 * An advert read by the rules, and by Claude as well where the rules can't judge it
 * (ai-requirements.ts). Without the key, or with the credit spent, the rules' reading stands.
 */
async function readWithRequirements(title: string, body: string): Promise<ReturnType<typeof readAdvert>> {
  const read = readAdvert(title, body);
  if (!claudeReady() || !needsClaude(read.requirements, body.length)) return read;
  try {
    const requirements = await claudeRequirements(body, read.requirements);
    if (!requirements) return read;
    // Kept even when it finds nothing on the list, so the advert isn't asked about again.
    return {
      ...read,
      requirements,
      details: { ...read.details, readBy: "claude" },
      extract_version: CLAUDE_READ_VERSION,
    };
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    console.error("claude", err.code);
    return read;
  }
}

/** The feeds' adverts the rules read too weakly to judge get Claude's reading, a few each check. */
async function readWeakAdverts() {
  if (!claudeReady()) return;
  const weak = await store.weakAdverts(CLAUDE_READS_PER_CHECK);
  let stop = false;
  const queue = [...weak];
  const worker = async () => {
    for (let row = queue.shift(); row && !stop; row = queue.shift()) {
      try {
        const requirements = await claudeRequirements(row.body, row.requirements);
        if (!requirements) continue;
        await store.setExtractions([
          {
            gid: row.gid,
            family: row.family,
            seniority: row.seniority,
            requirements,
            details: { ...row.details, readBy: "claude" },
            extract_version: CLAUDE_READ_VERSION,
          },
        ]);
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        console.error("claude", err.code);
        // A spent credit or a refused key won't change before the next check.
        if (err.code === "NO_CREDIT" || err.code === "BAD_KEY") stop = true;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/**
 * The advert of a role that arrived with only a link (a careers page lists no text),
 * read when the owner asks from its pane: the owner chose the link, as if they had
 * pasted it. Its requirements are read as for any advert, by Claude where the rules can't.
 */
export async function readRoleAdvert(gid: string): Promise<OpResult & { found?: number; readBy?: "claude" }> {
  if (!/^\d{1,18}$/.test(gid)) return { error: "That is not a role." };
  try {
    const role = (await store.listPostings()).find((r) => r.gid === gid);
    if (!role) return { error: "That role no longer exists." };
    if (!role.url) return { error: "This role has no link to read its advert from." };
    const page = await fetchJobPage(role.url, fetch, undefined, jobPagesTestOrigin());
    const data = postingData(page.html);
    let body = data && data.text.length >= ENOUGH_ADVERT ? data.text : pageText(page.html);
    if (body !== data?.text && claudeReady()) {
      // A page with no job data of its own: Claude finds the advert among its lines.
      try {
        const { ask, lines } = advertAsk(body, dateIn(now(), timeZone()));
        const reading = readAdvertAnswer(await askClaude(ask), lines);
        if (reading?.text) body = reading.text;
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        console.error("claude", err.code);
      }
    }
    const read = await readWithRequirements(role.title, body);
    await store.setAdvert(gid, {
      body,
      family: role.source_kind === "rse" && read.family === "software" ? "research" : read.family,
      seniority: read.seniority,
      requirements: read.requirements,
      details: read.details,
      extract_version: read.extract_version,
    });
    refreshPages();
    return { found: read.requirements.length, readBy: read.details.readBy };
  } catch (err) {
    if (err instanceof PageError)
      return {
        error:
          err.reason === "gone"
            ? err.message
            : `${err.message.replace(/ Copy the advert's text and paste it here instead\.$/, "")} Open the advert to read it yourself.`,
      };
    return fail(err, "Could not read that advert.");
  }
}

/** When the reading rules improve, old adverts get the benefit without any new requests. */
async function rereadOldAdverts() {
  for (let round = 0; round < 20; round++) {
    const stale = await store.staleExtractions(EXTRACT_VERSION);
    if (!stale.length) return;
    await store.setExtractions(
      stale.map((row) => {
        const { family, seniority, requirements, details, extract_version } = readAdvert(row.title, row.body);
        return {
          gid: row.gid,
          family: row.source_kind === "rse" && family === "software" ? "research" : family,
          seniority,
          requirements,
          details,
          extract_version,
        };
      }),
    );
  }
}

/** Adds an employer from a job link if it has a feed, and otherwise as a page to check by hand. */
export async function addSource(input: { link: string; name: string }): Promise<OpResult & { kind?: string }> {
  const link = input.link.trim();
  const name = input.name.trim();
  if (!name) return { error: "Say which employer this is." };
  if (!httpUrl(link)) return { error: "Paste a full link, starting with https://." };
  const board = parseBoardLink(link);
  try {
    if (board) {
      await store.addSource(board.kind, board.token, name, null);
      refreshPages();
      return { kind: board.kind };
    }
    const slug =
      new URL(link).hostname.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 80) +
      "-" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 30);
    await store.addSource("link", slug, name, link);
    refreshPages();
    return { kind: "link" };
  } catch (err) {
    return fail(err, "Could not add that employer.");
  }
}

export async function setSourceActive(gid: string, active: boolean): Promise<OpResult> {
  try {
    await store.updateSource(gid, { active });
    refreshPages();
    return {};
  } catch (err) {
    return fail(err, "Could not change that source.");
  }
}

export async function markSourceChecked(gid: string): Promise<OpResult> {
  try {
    await store.updateSource(gid, { checked: true });
    refreshPages();
    return {};
  } catch (err) {
    return fail(err, "Could not save that.");
  }
}

export type TrackingPatch = {
  interest?: number | null;
  stage?: string;
  next_action?: string;
  next_action_on?: string | null;
  notes?: string;
};

export async function setTracking(gid: string, patch: TrackingPatch): Promise<OpResult> {
  if (!/^\d{1,18}$/.test(gid)) return { error: "That is not a role." };
  if (patch.interest !== undefined && patch.interest !== null && ![0, 1, 2, 3].includes(patch.interest))
    return { error: "Choose an interest from the buttons." };
  if (patch.stage !== undefined && !STAGES.has(patch.stage)) return { error: "Choose a stage from the list." };
  if (patch.next_action_on && !isDay(patch.next_action_on)) return { error: "Pick a valid date." };
  if ((patch.next_action?.length ?? 0) > 300) return { error: "Keep the next action under 300 characters." };
  if ((patch.notes?.length ?? 0) > 5000) return { error: "Keep notes under 5,000 characters." };
  try {
    await store.setTracking(gid, patch);
    refreshPages();
    return {};
  } catch (err) {
    return fail(err, "Could not save that.");
  }
}

/** A role from anywhere: a recruiter's message, a referral, or a site with no feed. */
export async function addRoleByHand(input: {
  title: string;
  company: string;
  location: string;
  url: string;
  text: string;
  salary?: string;
  /** YYYY-MM-DD: the role starts with the step to apply by the day before. */
  closesOn?: string;
}): Promise<OpResult & { gid?: string }> {
  const title = input.title.trim();
  const company = input.company.trim();
  if (!title || !company) return { error: "A role needs a title and an employer." };
  if (input.url.trim() && !httpUrl(input.url)) return { error: "The link must start with https://." };
  const closesOn = input.closesOn?.trim() ?? "";
  if (closesOn && !isDay(closesOn)) return { error: "Pick a valid closing date." };
  const body = advertText(input.text);
  const read = await readWithRequirements(title, body);
  const step = closesOn ? applyBy(closesOn, dateIn(now(), timeZone())) : null;
  try {
    const gid = await store.addByHand(
      {
        title: title.slice(0, 300),
        company: company.slice(0, 200),
        location: input.location.trim().slice(0, 500),
        location_tier: locationTier([input.location]),
        url: input.url.trim() || null,
        salary: input.salary?.trim().slice(0, 200) || null,
        ...read,
        body,
      },
      step ?? {},
    );
    refreshPages();
    return { gid };
  } catch (err) {
    return fail(err, "Could not add that role.");
  }
}

/** What was read from a pasted link or advert, in the shape the form takes. */
export type RoleDraft = {
  title: string;
  company: string;
  location: string;
  url: string;
  salary: string;
  closesOn: string;
  text: string;
};

export type AdvertResult = OpResult & {
  gid?: string;
  title?: string;
  /** What read it: Claude, or the page's own job data. */
  readBy?: "claude" | "page";
  /** When Claude could not help, why, in the owner's words. */
  note?: string;
  /** Not added, because the title or employer is missing: what was read, for the form. */
  draft?: RoleDraft;
};

const LINK = /^https?:\/\/\S+$/i;
/** A page's job data with less advert than this still gets Claude's reading of the page. */
const ENOUGH_ADVERT = 200;

async function readWithClaude(text: string): Promise<{ reading: AdvertReading } | { problem: string }> {
  if (!claudeReady()) return { problem: aiProblem("NO_KEY") };
  const { ask, lines } = advertAsk(text, dateIn(now(), timeZone()));
  try {
    const reading = readAdvertAnswer(await askClaude(ask), lines);
    return reading ? { reading } : { problem: aiProblem("BAD_REPLY") };
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    // The code only: what Claude read, and what it said, may be personal.
    console.error("claude", err.code);
    return { problem: aiProblem(err.code) };
  }
}

/**
 * A role from a pasted job link or advert, added in one tap; the owner fixes any detail
 * in the role's pane afterwards. A link is read by the portal itself (job-page.ts).
 * The page's own job data is used first, since it is free; Claude is asked only for
 * what that leaves out. With neither, nothing is added: the form gets what was read.
 */
export async function addRoleFromAdvert(input: { source: string }): Promise<AdvertResult> {
  const source = input.source.trim();
  if (!source) return { error: "Paste a job link or the advert first." };
  const isLink = LINK.test(source);
  let data: PostingData | null = null;
  let text: string;
  try {
    if (isLink) {
      const page = await fetchJobPage(source, fetch, undefined, jobPagesTestOrigin());
      data = postingData(page.html);
      text = data && data.text.length >= ENOUGH_ADVERT ? data.text : pageText(page.html);
    } else {
      text = advertText(source);
    }
  } catch (err) {
    if (err instanceof PageError) return { error: err.message };
    return fail(err, "Could not read that page.");
  }

  const draft: RoleDraft = {
    title: data?.title ?? "",
    company: data?.company ?? "",
    location: data?.location ?? "",
    url: isLink ? source : "",
    salary: data?.salary ?? "",
    closesOn: data?.closesOn ?? "",
    text,
  };
  let readBy: AdvertResult["readBy"];
  let note: string | undefined;
  if (data?.title && data.company && data.text.length >= ENOUGH_ADVERT) {
    readBy = "page";
  } else {
    const read = await readWithClaude(text);
    if ("problem" in read) {
      note = read.problem;
    } else if (!read.reading.isAdvert) {
      return { error: "That doesn't look like an advert for one role. Open the role itself, or paste its text." };
    } else {
      // The page's own data wins where it has a field: it is the site's, not a reading.
      const r = read.reading;
      draft.title ||= r.title;
      draft.company ||= r.company;
      draft.location ||= r.location;
      draft.salary ||= r.salary;
      draft.closesOn ||= r.closesOn;
      if (r.text) draft.text = r.text;
      readBy = "claude";
    }
  }
  if (!draft.title || !draft.company)
    return { draft, note: note ?? "The advert doesn't say clearly what the role is or who is hiring." };

  const added = await addRoleByHand(draft);
  return added.error ? { error: added.error } : { gid: added.gid, title: draft.title, readBy, note };
}

export type DetailsInput = { title: string; company: string; location: string; url: string; salary: string };

/** Fixes the details of a role added by hand: its title, employer, place, link and pay. */
export async function editRoleDetails(gid: string, input: DetailsInput): Promise<OpResult> {
  if (!/^\d{1,18}$/.test(gid)) return { error: "That is not a role." };
  const title = input.title.trim();
  const company = input.company.trim();
  const location = input.location.trim();
  const url = input.url.trim();
  const salary = input.salary.trim();
  if (!title || !company) return { error: "A role needs a title and an employer." };
  if (url && !httpUrl(url)) return { error: "The link must start with https://." };
  if (title.length > 300 || company.length > 200 || location.length > 500 || salary.length > 200)
    return { error: "That is too long to save. Shorten it a little." };
  try {
    const { body } = await store.postingDetail(gid);
    await store.editDetails(gid, {
      title,
      company,
      location,
      location_tier: locationTier([location]),
      url,
      salary,
      family: familyOf(title) ?? "software",
      seniority: seniorityOf(title, body),
    });
    refreshPages();
    return {};
  } catch (err) {
    return fail(err, "Could not save those details.");
  }
}

export async function addEvidence(input: {
  skill: string;
  level: number;
  note: string;
  url: string;
}): Promise<OpResult> {
  if (!skillByKey(input.skill)) return { error: "Choose a skill from the list." };
  if (![1, 2, 3, 4].includes(input.level)) return { error: "Choose a level from the list." };
  if (!input.note.trim()) return { error: "Say what the evidence is." };
  if (input.url.trim() && !httpUrl(input.url)) return { error: "The link must start with https://." };
  try {
    await store.addEvidence(input.skill, input.level, input.note.slice(0, 300), input.url.trim() || null);
    refreshPages();
    return {};
  } catch (err) {
    return fail(err, "Could not add that evidence.");
  }
}

export async function removeEvidence(gid: string): Promise<OpResult> {
  try {
    await store.removeEvidence(gid);
    refreshPages();
    return {};
  } catch (err) {
    return fail(err, "Could not remove that.");
  }
}
