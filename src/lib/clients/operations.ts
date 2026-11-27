import "server-only";
import { revalidatePath } from "next/cache";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { dateIn } from "../dates/week";
import * as store from "./store";
import {
  CHANNEL_MAX,
  cleanOptional,
  cleanText,
  cleanUrl,
  isAmount,
  isDay,
  isPricing,
  isRelationship,
  isStage,
  isTimeZone,
  MILESTONE_MAX,
  NAME_MAX,
  NOTES_MAX,
  TITLE_MAX,
  type Client,
  type ClientProject,
  type ClientsData,
  type Milestone,
} from "./clients";

// Every change to client projects, shared by the page's actions and Claude's
// tools (./connector.ts). Each answers { error } with a message for people rather
// than throwing, and no message repeats a name or a title: errors can end up in
// public bug reports.

export type Result<T> = { value: T; error?: undefined } | { error: string };

const PAGE = "/clients";
const GID = /^\d+$/;

const NO_NAME = "Write the client's name, in up to 120 characters.";
const NO_RELATIONSHIP = "Say how you know them: family, friend, referral or other.";
const NO_CHANNEL = "Where you talk fits in 80 characters.";
const NO_TIME_ZONE = "Give a time zone such as Europe/Paris, or none.";
const NO_NOTES = "Notes fit in 2,000 characters.";
const NO_TITLE = "Write the project's title, in up to 120 characters.";
const NO_STAGE = "Pick a stage: lead, scoping, agreed, building, handed over, support or closed.";
const NO_PRICING = "Pick how it is priced: fixed, day rate or unpaid.";
const NO_URL = "Links start with https:// and have no spaces.";
const NO_MILESTONE = "Write the milestone, in up to 200 characters.";
const NO_DAY = "Pick a real day, or none.";
const NO_AMOUNT = "Give the amount in pence, a whole number from 0 up to a million pounds, or none.";
const NOTHING = "Say what to change.";
const GONE = "That is not there any more.";

export async function loadClients(): Promise<
  { data: ClientsData; today: string; error?: undefined } | { error: string }
> {
  try {
    return { data: await store.readClients(), today: dateIn(now(), timeZone()) };
  } catch (e) {
    return {
      error: e instanceof store.ClientsError ? e.message : "Your clients could not be read. Try again in a minute.",
    };
  }
}

async function save<T>(change: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await change();
    revalidatePath(PAGE);
    return { value };
  } catch (e) {
    return { error: e instanceof store.ClientsError ? e.message : "That didn't save. Try again." };
  }
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export type ClientInput = { name: string; relationship?: string; channel?: string | null };

export async function addClient(input: ClientInput): Promise<Result<Client>> {
  const name = cleanText(input.name, NAME_MAX);
  if (!name) return { error: NO_NAME };
  const relationship = input.relationship ?? "referral";
  if (!isRelationship(relationship)) return { error: NO_RELATIONSHIP };
  const channel = cleanOptional(input.channel ?? null, CHANNEL_MAX);
  if (channel === undefined) return { error: NO_CHANNEL };
  return save(() => store.addClient(name, relationship, channel));
}

export type ClientChange = {
  name?: string;
  relationship?: string;
  channel?: string | null;
  timeZone?: string | null;
  notes?: string | null;
};

/** Changes only what is given. Null, or blank text, clears the channel, time zone or notes. */
export async function updateClient(gid: string, change: ClientChange): Promise<Result<Client>> {
  if (!GID.test(gid)) return { error: GONE };
  const changes: Record<string, string | null> = {};
  if (change.name !== undefined) {
    const name = cleanText(change.name, NAME_MAX);
    if (!name) return { error: NO_NAME };
    changes.name = name;
  }
  if (change.relationship !== undefined) {
    if (!isRelationship(change.relationship)) return { error: NO_RELATIONSHIP };
    changes.relationship = change.relationship;
  }
  if (change.channel !== undefined) {
    const channel = cleanOptional(change.channel, CHANNEL_MAX);
    if (channel === undefined) return { error: NO_CHANNEL };
    changes.channel = channel;
  }
  if (change.timeZone !== undefined) {
    const zone = cleanOptional(change.timeZone, 64);
    if (zone === undefined || (zone !== null && !isTimeZone(zone))) return { error: NO_TIME_ZONE };
    changes.time_zone = zone;
  }
  if (change.notes !== undefined) {
    const notes = cleanOptional(change.notes, NOTES_MAX);
    if (notes === undefined) return { error: NO_NOTES };
    changes.notes = notes;
  }
  if (Object.keys(changes).length === 0) return { error: NOTHING };
  return save(() => store.setClient(gid, changes));
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectInput = { title: string; pricing?: string };

export async function addProject(clientGid: string, input: ProjectInput): Promise<Result<ClientProject>> {
  if (!GID.test(clientGid)) return { error: GONE };
  const title = cleanText(input.title, TITLE_MAX);
  if (!title) return { error: NO_TITLE };
  const pricing = input.pricing ?? "fixed";
  if (!isPricing(pricing)) return { error: NO_PRICING };
  return save(() => store.addProject(clientGid, title, pricing));
}

export type ProjectChange = {
  title?: string;
  stage?: string;
  pricing?: string;
  repoUrl?: string | null;
  previewUrl?: string | null;
  liveUrl?: string | null;
  notes?: string | null;
};

const LINKS = [
  ["repoUrl", "repo_url"],
  ["previewUrl", "preview_url"],
  ["liveUrl", "live_url"],
] as const;

/** Changes only what is given. Null, or blank text, clears a link or the notes. */
export async function updateProject(gid: string, change: ProjectChange): Promise<Result<ClientProject>> {
  if (!GID.test(gid)) return { error: GONE };
  const changes: Record<string, string | null> = {};
  if (change.title !== undefined) {
    const title = cleanText(change.title, TITLE_MAX);
    if (!title) return { error: NO_TITLE };
    changes.title = title;
  }
  if (change.stage !== undefined) {
    if (!isStage(change.stage)) return { error: NO_STAGE };
    changes.stage = change.stage;
  }
  if (change.pricing !== undefined) {
    if (!isPricing(change.pricing)) return { error: NO_PRICING };
    changes.pricing = change.pricing;
  }
  for (const [key, column] of LINKS) {
    if (change[key] === undefined) continue;
    const url = cleanUrl(change[key]);
    if (url === undefined) return { error: NO_URL };
    changes[column] = url;
  }
  if (change.notes !== undefined) {
    const notes = cleanOptional(change.notes, NOTES_MAX);
    if (notes === undefined) return { error: NO_NOTES };
    changes.notes = notes;
  }
  if (Object.keys(changes).length === 0) return { error: NOTHING };
  return save(() => store.setProject(gid, changes));
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export type MilestoneInput = { title: string; dueOn?: string | null; amountPence?: number | null };

export async function addMilestone(projectGid: string, input: MilestoneInput): Promise<Result<Milestone>> {
  if (!GID.test(projectGid)) return { error: GONE };
  const title = cleanText(input.title, MILESTONE_MAX);
  if (!title) return { error: NO_MILESTONE };
  const dueOn = input.dueOn ?? null;
  if (dueOn !== null && !isDay(dueOn)) return { error: NO_DAY };
  const amount = input.amountPence ?? null;
  if (amount !== null && !isAmount(amount)) return { error: NO_AMOUNT };
  return save(() => store.addMilestone(projectGid, title, dueOn, amount));
}

export type MilestoneChange = {
  title?: string;
  dueOn?: string | null;
  amountPence?: number | null;
  acceptedOn?: string | null;
  paidOn?: string | null;
};

const DAYS = [
  ["dueOn", "due_on"],
  ["acceptedOn", "accepted_on"],
  ["paidOn", "paid_on"],
] as const;

/** Changes only what is given. Null clears the day, the amount, or whether it was accepted or paid. */
export async function updateMilestone(gid: string, change: MilestoneChange): Promise<Result<Milestone>> {
  if (!GID.test(gid)) return { error: GONE };
  const changes: Record<string, string | number | null> = {};
  if (change.title !== undefined) {
    const title = cleanText(change.title, MILESTONE_MAX);
    if (!title) return { error: NO_MILESTONE };
    changes.title = title;
  }
  for (const [key, column] of DAYS) {
    const day = change[key];
    if (day === undefined) continue;
    if (day !== null && !isDay(day)) return { error: NO_DAY };
    changes[column] = day;
  }
  if (change.amountPence !== undefined) {
    if (change.amountPence !== null && !isAmount(change.amountPence)) return { error: NO_AMOUNT };
    changes.amount_pence = change.amountPence;
  }
  if (Object.keys(changes).length === 0) return { error: NOTHING };
  return save(() => store.setMilestone(gid, changes));
}

/** Marks a milestone accepted or paid today, or takes that back. */
export async function markMilestone(gid: string, mark: "accepted" | "paid", done: boolean): Promise<Result<Milestone>> {
  const day = done ? dateIn(now(), timeZone()) : null;
  return updateMilestone(gid, mark === "accepted" ? { acceptedOn: day } : { paidOn: day });
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

/** Deletes a client (with its projects and milestones), a project (with its milestones) or a milestone. */
export async function removeRecord(
  kind: string,
  gid: string,
): Promise<Result<{ kind: store.RecordKind; gid: string }>> {
  if (kind !== "client" && kind !== "project" && kind !== "milestone")
    return { error: "Remove a client, a project or a milestone." };
  if (!GID.test(gid)) return { error: GONE };
  return save(() => store.remove(kind, gid));
}
