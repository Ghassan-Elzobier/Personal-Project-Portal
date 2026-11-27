import "server-only";
import { err, ok, type Json, type Tool } from "../mcp/tool";
import {
  CHANNEL_MAX,
  clientTree,
  MILESTONE_MAX,
  NAME_MAX,
  NOTES_MAX,
  PRICINGS,
  RELATIONSHIPS,
  STAGES,
  summary,
  TITLE_MAX,
  type Client,
  type ClientProject,
  type ClientView,
  type Milestone,
  type ProjectView,
} from "./clients";
import * as ops from "./operations";

// Claude's tools for client projects: software the owner builds for other people.
// Writes go through the same operations as the page's buttons. None of it reaches
// the tasks, so mentors never see it.

export const CLIENT_INSTRUCTIONS =
  "Software the owner builds for other people is the Clients space: clients, their projects (stage, pricing, repo, preview and live links) and each project's milestones (due day, amount in pence, accepted and paid days). Call list_client_projects first. Only the owner sees it: client work never goes on tasks, which mentors see.";

const GID = (what: string) => ({
  type: "string",
  pattern: "^\\d+$",
  description: `${what}, from list_client_projects.`,
});
const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const NULLABLE_DAY = (description: string) => ({ anyOf: [DAY, { type: "null" }], description });
const NULLABLE_TEXT = (max: number, description: string) => ({
  anyOf: [{ type: "string", maxLength: max }, { type: "null" }],
  description,
});
const LINK = (description: string) => ({
  anyOf: [{ type: "string", pattern: "^https://\\S+$", maxLength: 300 }, { type: "null" }],
  description: `${description} An https link, or null to clear it.`,
});
const AMOUNT = {
  anyOf: [{ type: "integer", minimum: 0, maximum: 100_000_000 }, { type: "null" }],
  description: "Amount agreed for it, in pence (150000 is £1,500), or null for none.",
};

const milestoneForClaude = (m: Milestone) => ({
  milestone_gid: m.gid,
  title: m.title,
  due_on: m.dueOn,
  amount_pence: m.amountPence,
  accepted_on: m.acceptedOn,
  paid_on: m.paidOn,
});

const projectForClaude = (p: ClientProject) => ({
  project_gid: p.gid,
  client_gid: p.clientGid,
  title: p.title,
  stage: p.stage,
  pricing: p.pricing,
  repo_url: p.repoUrl,
  preview_url: p.previewUrl,
  live_url: p.liveUrl,
  notes: p.notes,
});

const clientForClaude = (c: Client) => ({
  client_gid: c.gid,
  name: c.name,
  relationship: c.relationship,
  channel: c.channel,
  time_zone: c.timeZone,
  notes: c.notes,
});

const viewForClaude = (c: ClientView) => ({
  ...clientForClaude(c),
  projects: c.projects.map((p: ProjectView) => ({
    ...projectForClaude(p),
    next_milestone: p.next ? milestoneForClaude(p.next) : null,
    money: { agreed_pence: p.agreedPence, paid_pence: p.paidPence, owed_pence: p.owedPence },
    milestones: p.milestones.map(milestoneForClaude),
  })),
});

const page = (base: string) => `${base}/clients`;
const text = (args: Json, key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
/** A value Claude may set to null to clear it: undefined when left out. */
const clearable = <T>(args: Json, key: string): T | null | undefined =>
  args[key] === null ? null : args[key] === undefined ? undefined : (args[key] as T);

function answer<T>(r: ops.Result<T>, key: string, shape: (value: T) => unknown, base: string) {
  return r.error !== undefined ? err(r.error) : ok({ [key]: shape(r.value), page: page(base) });
}

export const CLIENT_TOOLS: Tool[] = [
  {
    name: "list_client_projects",
    title: "Client projects",
    description:
      "Every client with their projects and milestones: each project's stage, pricing, links, next milestone and money (agreed, paid, and accepted but unpaid, in pence), plus live projects, money owed and the next milestone due across all of them. Only the owner sees this. Study work is tasks: list_tasks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(_args, { base }) {
      const loaded = await ops.loadClients();
      if (loaded.error !== undefined) return err(loaded.error);
      const tree = clientTree(loaded.data);
      const s = summary(tree);
      return ok({
        today: loaded.today,
        live_projects: s.liveProjects,
        owed_pence: s.owedPence,
        next_milestone: s.next && {
          client: s.next.client,
          project: s.next.project,
          ...milestoneForClaude(s.next.milestone),
        },
        clients: tree.map(viewForClaude),
        page: page(base),
      });
    },
  },
  {
    name: "add_client",
    title: "Add a client",
    description:
      "Adds a client: someone the owner builds software for. Then add their project with add_client_project. Only the owner sees clients.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: NAME_MAX, description: "The client's name." },
        relationship: { type: "string", enum: [...RELATIONSHIPS], description: "How the owner knows them." },
        channel: { type: "string", maxLength: CHANNEL_MAX, description: "Where they talk, such as WhatsApp or email." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.addClient({
        name: String(args.name),
        relationship: text(args, "relationship"),
        channel: text(args, "channel") ?? null,
      });
      return answer(r, "added", clientForClaude, base);
    },
  },
  {
    name: "update_client",
    title: "Change a client",
    description:
      "Changes a client's name, relationship, channel, time zone (IANA, such as Europe/Paris) or notes. Only what is given changes; null clears the channel, time zone or notes.",
    inputSchema: {
      type: "object",
      properties: {
        client_gid: GID("client_gid"),
        name: { type: "string", minLength: 1, maxLength: NAME_MAX },
        relationship: { type: "string", enum: [...RELATIONSHIPS] },
        channel: NULLABLE_TEXT(CHANNEL_MAX, "Where they talk, or null."),
        time_zone: NULLABLE_TEXT(64, "Their time zone, such as Europe/Paris, or null."),
        notes: NULLABLE_TEXT(NOTES_MAX, "Notes about the client, or null."),
      },
      required: ["client_gid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.updateClient(String(args.client_gid), {
        name: text(args, "name"),
        relationship: text(args, "relationship"),
        channel: clearable<string>(args, "channel"),
        timeZone: clearable<string>(args, "time_zone"),
        notes: clearable<string>(args, "notes"),
      });
      return answer(r, "saved", clientForClaude, base);
    },
  },
  {
    name: "add_client_project",
    title: "Add a client project",
    description:
      "Adds a project for a client, starting as a lead. Move it on with update_client_project, and add its milestones with add_client_milestone.",
    inputSchema: {
      type: "object",
      properties: {
        client_gid: GID("client_gid"),
        title: { type: "string", minLength: 1, maxLength: TITLE_MAX, description: "What is being built." },
        pricing: { type: "string", enum: [...PRICINGS], description: "How it is priced. Fixed unless said." },
      },
      required: ["client_gid", "title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.addProject(String(args.client_gid), {
        title: String(args.title),
        pricing: text(args, "pricing"),
      });
      return answer(r, "added", projectForClaude, base);
    },
  },
  {
    name: "update_client_project",
    title: "Change a client project",
    description:
      "Moves a client project to another stage (lead, scoping, agreed, building, handed_over, support, closed), or changes its title, pricing, repo, preview or live link, or notes. Only what is given changes.",
    inputSchema: {
      type: "object",
      properties: {
        project_gid: GID("project_gid"),
        title: { type: "string", minLength: 1, maxLength: TITLE_MAX },
        stage: { type: "string", enum: [...STAGES] },
        pricing: { type: "string", enum: [...PRICINGS] },
        repo_url: LINK("The code repository."),
        preview_url: LINK("Where the client tries the work in progress."),
        live_url: LINK("The live site or app."),
        notes: NULLABLE_TEXT(NOTES_MAX, "Notes about the project, or null."),
      },
      required: ["project_gid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.updateProject(String(args.project_gid), {
        title: text(args, "title"),
        stage: text(args, "stage"),
        pricing: text(args, "pricing"),
        repoUrl: clearable<string>(args, "repo_url"),
        previewUrl: clearable<string>(args, "preview_url"),
        liveUrl: clearable<string>(args, "live_url"),
        notes: clearable<string>(args, "notes"),
      });
      return answer(r, "saved", projectForClaude, base);
    },
  },
  {
    name: "add_client_milestone",
    title: "Add a milestone",
    description:
      "Adds a deliverable to a client project, with the day it is due and the amount agreed for it in pence. Mark it accepted or paid later with update_client_milestone.",
    inputSchema: {
      type: "object",
      properties: {
        project_gid: GID("project_gid"),
        title: { type: "string", minLength: 1, maxLength: MILESTONE_MAX, description: "What is delivered." },
        due_on: { ...DAY, description: "The day it is due, YYYY-MM-DD. Leave out for no day." },
        amount_pence: AMOUNT,
      },
      required: ["project_gid", "title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.addMilestone(String(args.project_gid), {
        title: String(args.title),
        dueOn: text(args, "due_on") ?? null,
        amountPence: typeof args.amount_pence === "number" ? args.amount_pence : null,
      });
      return answer(r, "added", milestoneForClaude, base);
    },
  },
  {
    name: "update_client_milestone",
    title: "Change a milestone",
    description:
      "Records the day the client accepted a milestone (accepted_on) or paid for it (paid_on), or changes its title, due day or amount. Only what is given changes; null clears a day or the amount.",
    inputSchema: {
      type: "object",
      properties: {
        milestone_gid: GID("milestone_gid"),
        title: { type: "string", minLength: 1, maxLength: MILESTONE_MAX },
        due_on: NULLABLE_DAY("The day it is due, YYYY-MM-DD, or null."),
        amount_pence: AMOUNT,
        accepted_on: NULLABLE_DAY("The day the client accepted it, YYYY-MM-DD, or null to take that back."),
        paid_on: NULLABLE_DAY("The day it was paid, YYYY-MM-DD, or null to take that back."),
      },
      required: ["milestone_gid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.updateMilestone(String(args.milestone_gid), {
        title: text(args, "title"),
        dueOn: clearable<string>(args, "due_on"),
        amountPence: clearable<number>(args, "amount_pence"),
        acceptedOn: clearable<string>(args, "accepted_on"),
        paidOn: clearable<string>(args, "paid_on"),
      });
      return answer(r, "saved", milestoneForClaude, base);
    },
  },
  {
    name: "remove_client_record",
    title: "Delete a client, project or milestone",
    description:
      "Deletes a client (with all their projects and milestones), a project (with its milestones) or a milestone, for good. To finish a project, move it to the closed stage with update_client_project instead.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["client", "project", "milestone"] },
        gid: GID("The client_gid, project_gid or milestone_gid"),
      },
      required: ["kind", "gid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async run(args, { base }) {
      const r = await ops.removeRecord(String(args.kind), String(args.gid));
      return r.error !== undefined ? err(r.error) : ok({ deleted: r.value, page: page(base) });
    },
  },
];
