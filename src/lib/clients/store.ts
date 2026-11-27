import "server-only";
import { rpcAsCaller } from "../supabase/caller";
import type { Client, ClientProject, ClientsData, Milestone, Pricing, Relationship, Stage } from "./clients";

// The Clients tables, through their RPCs (supabase/migrations/20261127091600_clients.sql).
// Browser calls use the session; connector calls prove themselves with their token.

export class ClientsError extends Error {}

/** Codes whose message the RPCs wrote for people, so it can be shown as it is. */
const READABLE = new Set(["42501", "P0002", "22023"]);
/** Codes for a value the database refused: a check, a bad number or a bad day. */
const INVALID = new Set(["23514", "22P02", "22007", "22008", "22003"]);

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpcAsCaller(name, args);
  if (error) {
    if (error.code === "PGRST202")
      throw new ClientsError("The Clients tables are not in the database yet. Run the latest migration.");
    if (!READABLE.has(error.code)) console.error(name, error.code, error.message);
    throw new ClientsError(
      READABLE.has(error.code)
        ? error.message
        : INVALID.has(error.code)
          ? "Those values are not valid."
          : "The database did not answer. Try again in a minute.",
    );
  }
  return data as T;
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

const clientOf = (r: Row): Client => ({
  gid: String(r.gid),
  name: String(r.name),
  relationship: r.relationship as Relationship,
  channel: text(r.channel),
  timeZone: text(r.time_zone),
  notes: text(r.notes),
});

const projectOf = (r: Row): ClientProject => ({
  gid: String(r.gid),
  clientGid: String(r.client_gid),
  title: String(r.title),
  stage: r.stage as Stage,
  pricing: r.pricing as Pricing,
  repoUrl: text(r.repo_url),
  previewUrl: text(r.preview_url),
  liveUrl: text(r.live_url),
  notes: text(r.notes),
});

const milestoneOf = (r: Row): Milestone => ({
  gid: String(r.gid),
  projectGid: String(r.project_gid),
  title: String(r.title),
  dueOn: text(r.due_on),
  amountPence: r.amount_pence === null || r.amount_pence === undefined ? null : Number(r.amount_pence),
  acceptedOn: text(r.accepted_on),
  paidOn: text(r.paid_on),
});

export async function readClients(): Promise<ClientsData> {
  const data = await rpc<{ clients?: Row[]; projects?: Row[]; milestones?: Row[] } | null>("clients_read");
  return {
    clients: (data?.clients ?? []).map(clientOf),
    projects: (data?.projects ?? []).map(projectOf),
    milestones: (data?.milestones ?? []).map(milestoneOf),
  };
}

export const addClient = async (name: string, relationship: Relationship, channel: string | null) =>
  clientOf(await rpc<Row>("clients_add_client", { p_name: name, p_relationship: relationship, p_channel: channel }));

/** Only the keys given change: name, relationship, channel, time_zone and notes (null clears the last three). */
export const setClient = async (gid: string, changes: Record<string, string | null>) =>
  clientOf(await rpc<Row>("clients_set_client", { p_gid: gid, p_changes: changes }));

export const addProject = async (clientGid: string, title: string, pricing: Pricing) =>
  projectOf(await rpc<Row>("clients_add_project", { p_client_gid: clientGid, p_title: title, p_pricing: pricing }));

/** Only the keys given change: title, stage, pricing, repo_url, preview_url, live_url and notes. */
export const setProject = async (gid: string, changes: Record<string, string | null>) =>
  projectOf(await rpc<Row>("clients_set_project", { p_gid: gid, p_changes: changes }));

export const addMilestone = async (
  projectGid: string,
  title: string,
  dueOn: string | null,
  amountPence: number | null,
) =>
  milestoneOf(
    await rpc<Row>("clients_add_milestone", {
      p_project_gid: projectGid,
      p_title: title,
      p_due_on: dueOn,
      p_amount_pence: amountPence,
    }),
  );

/** Only the keys given change: title, due_on, amount_pence, accepted_on and paid_on (null clears all but the title). */
export const setMilestone = async (gid: string, changes: Record<string, string | number | null>) =>
  milestoneOf(await rpc<Row>("clients_set_milestone", { p_gid: gid, p_changes: changes }));

export type RecordKind = "client" | "project" | "milestone";

/** Deletes a client (with its projects), a project (with its milestones) or a milestone for good. */
export const remove = async (kind: RecordKind, gid: string) => {
  await rpc<Row>("clients_remove", { p_kind: kind, p_gid: gid });
  return { kind, gid };
};
