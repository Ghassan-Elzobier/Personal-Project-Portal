"use server";

import { requireOwner } from "@/lib/auth/access";
import { parsePounds } from "@/lib/clients/clients";
import * as ops from "@/lib/clients/operations";

// The Clients page's buttons and forms. Each checks for the owner, then runs the
// shared operation, so a button and a Claude tool can never allow different things.

export async function addClient(name: string, relationship: string, channel: string) {
  await requireOwner();
  return ops.addClient({ name, relationship, channel });
}

export async function addProject(clientGid: string, title: string, pricing: string) {
  await requireOwner();
  return ops.addProject(clientGid, { title, pricing });
}

export async function setStage(gid: string, stage: string) {
  await requireOwner();
  return ops.updateProject(gid, { stage });
}

export async function saveProjectDetails(
  gid: string,
  details: { repoUrl: string; previewUrl: string; liveUrl: string; notes: string },
) {
  await requireOwner();
  return ops.updateProject(gid, {
    repoUrl: details.repoUrl,
    previewUrl: details.previewUrl,
    liveUrl: details.liveUrl,
    notes: details.notes,
  });
}

export async function addMilestone(projectGid: string, title: string, dueOn: string, amount: string) {
  await requireOwner();
  const amountPence = parsePounds(amount);
  if (amountPence === undefined)
    return { error: "Write the amount in pounds, such as 1500 or 1,500.50, or leave it empty." };
  return ops.addMilestone(projectGid, { title, dueOn: dueOn === "" ? null : dueOn, amountPence });
}

export async function markMilestone(gid: string, mark: "accepted" | "paid", done: boolean) {
  await requireOwner();
  return ops.markMilestone(gid, mark === "paid" ? "paid" : "accepted", done === true);
}

export async function removeRecord(kind: string, gid: string) {
  await requireOwner();
  return ops.removeRecord(kind, gid);
}
