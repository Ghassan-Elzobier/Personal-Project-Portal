import "server-only";
import { revalidatePath } from "next/cache";
import { locationTier } from "../jobs/classify";
import { advertText, EXTRACT_VERSION } from "../jobs/extract";
import { FEED_KINDS, parseBoardLink, readFeed } from "../jobs/feeds";
import { followedNames, readAdvert, toPosting } from "../jobs/ingest";
import { skillByKey } from "../jobs/skills";
import * as store from "../jobs/store";

// Every change the job tracker makes. Pages and buttons call these; nothing here is
// reachable from the Claude connector.

export type OpResult = { error?: string };

const STAGES = new Set(["new", "saved", "applied", "interview", "offer", "rejected", "passed"]);
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
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

async function runRefresh(): Promise<RefreshResult> {
  try {
    const all = await store.listSources();
    const followed = followedNames(all);
    const sources = all.filter((s) => s.active && (FEED_KINDS as readonly string[]).includes(s.kind));
    let added = 0;
    let closed = 0;
    const failed: string[] = [];

    const queue = [...sources];
    const worker = async () => {
      for (let source = queue.shift(); source; source = queue.shift()) {
        const known = source.kind === "greenhouse" ? new Set(await store.knownIds(source.gid)) : new Set<string>();
        const read = await readFeed(source, known);
        const postings = read.jobs.flatMap((job) => toPosting(job, source!.kind, followed) ?? []);
        const saved = await store.saveRead(source.gid, read, postings);
        added += saved.added;
        closed += saved.closed;
        if (!read.ok) failed.push(source.name);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    await rereadOldAdverts();
    refreshPages();
    return { read: sources.length, added, closed, failed };
  } catch (err) {
    return fail(err, "Could not read the feeds.");
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
  if (patch.next_action_on && !isDate(patch.next_action_on)) return { error: "Pick a valid date." };
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
}): Promise<OpResult & { gid?: string }> {
  const title = input.title.trim();
  const company = input.company.trim();
  if (!title || !company) return { error: "A role needs a title and an employer." };
  if (input.url.trim() && !httpUrl(input.url)) return { error: "The link must start with https://." };
  const body = advertText(input.text);
  const read = readAdvert(title, body);
  try {
    const gid = await store.addByHand(
      {
        title: title.slice(0, 300),
        company: company.slice(0, 200),
        location: input.location.trim().slice(0, 500),
        location_tier: locationTier([input.location]),
        url: input.url.trim() || null,
        ...read,
        body,
      },
      {},
    );
    refreshPages();
    return { gid };
  } catch (err) {
    return fail(err, "Could not add that role.");
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
