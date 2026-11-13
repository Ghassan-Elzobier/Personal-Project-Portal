import "server-only";
import { createClient } from "../supabase/server";
import { AsanaError } from "../tasks/model";
import type { PostingRow } from "./ingest";
import type { Details, Requirement, Seniority } from "./extract";
import type { StoredEvidence } from "./match";

// The job tables, reached through their RPCs. Always the signed-in session, never the
// connector's route: see the note at the top of the migration.

const READABLE = new Set(["42501", "P0002", "22023"]);

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = await createClient();
  const { data, error } = await client.rpc(name, args);
  if (error) {
    console.error(name, error.message);
    if (error.code === "PGRST202") throw new AsanaError("The job tracker's database tables are not there yet.", 500);
    throw new AsanaError(
      READABLE.has(error.code)
        ? error.message
        : error.code === "23514" || error.code === "22P02"
          ? "Those values are not valid."
          : "The job database did not answer. Try again in a minute.",
      500,
    );
  }
  return data as T;
}

export type JobSource = {
  gid: string;
  kind: string;
  token: string;
  name: string;
  careers_url: string | null;
  active: boolean;
  last_read_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_count: number | null;
  last_checked_on: string | null;
};

export type JobStage = "new" | "saved" | "applied" | "interview" | "offer" | "rejected" | "passed";

export type JobRow = {
  gid: string;
  source_kind: string;
  source_name: string;
  title: string;
  company: string;
  location: string;
  location_tier: string;
  url: string | null;
  posted_on: string | null;
  salary: string | null;
  family: string;
  seniority: Seniority;
  has_body: boolean;
  requirements: Requirement[];
  details: Details;
  first_seen_at: string;
  last_seen_at: string;
  closed_at: string | null;
  interest: number | null;
  stage: JobStage;
  next_action: string;
  next_action_on: string | null;
  notes: string;
  legacy_rating: number | null;
  applied_on: string | null;
};

export const listSources = () => rpc<JobSource[]>("tracker_job_sources");
export const addSource = (kind: string, token: string, name: string, careersUrl: string | null) =>
  rpc<string>("tracker_add_job_source", { p_kind: kind, p_token: token, p_name: name, p_careers_url: careersUrl });
export const updateSource = (gid: string, change: { active?: boolean; checked?: boolean }) =>
  rpc<void>("tracker_update_job_source", {
    p_gid: gid,
    p_active: change.active ?? null,
    p_checked: change.checked ?? false,
  });

export const knownIds = (source: string) => rpc<string[]>("tracker_job_known_ids", { p_source: source });
export const saveRead = (
  source: string,
  read: { ok: boolean; error: string | null; seen: string[] | null },
  postings: PostingRow[],
) =>
  rpc<{ added: number; closed: number }>("tracker_save_job_read", {
    p_source: source,
    p_ok: read.ok,
    p_error: read.error,
    p_seen: read.seen,
    p_postings: postings,
  });

export const listPostings = () => rpc<JobRow[]>("tracker_job_postings");
export const postingDetail = (gid: string) =>
  rpc<{ body: string; events: { stage: string; created_at: string }[] }>("tracker_job_detail", { p_gid: gid });

export const staleExtractions = (version: number) =>
  rpc<{ gid: string; title: string; source_kind: string; location_tier: string; body: string }[]>(
    "tracker_job_stale_extractions",
    { p_version: version },
  );
export const setExtractions = (
  items: {
    gid: string;
    family: string;
    seniority: string;
    requirements: Requirement[];
    details: Details;
    extract_version: number;
  }[],
) => rpc<void>("tracker_set_job_extractions", { p_items: items });

export const setTracking = (gid: string, patch: Record<string, unknown>) =>
  rpc<void>("tracker_set_job_tracking", { p_posting: gid, p_patch: patch });
export const addByHand = (posting: Record<string, unknown>, tracking: Record<string, unknown>) =>
  rpc<string>("tracker_add_job_by_hand", { p_posting: posting, p_tracking: tracking });

export const listEvidence = () => rpc<StoredEvidence[]>("tracker_skill_evidence");
export const addEvidence = (skill: string, level: number, note: string, url: string | null) =>
  rpc<void>("tracker_add_skill_evidence", { p_skill: skill, p_level: level, p_note: note, p_url: url });
export const removeEvidence = (gid: string) => rpc<void>("tracker_delete_skill_evidence", { p_gid: gid });
