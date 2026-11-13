"use server";

import { requireOwner } from "@/lib/auth/access";
import * as jobs from "@/lib/portal/jobs";

export async function refreshJobs(): Promise<jobs.RefreshResult> {
  await requireOwner();
  return jobs.refreshJobs();
}

export async function addSource(input: { link: string; name: string }) {
  await requireOwner();
  return jobs.addSource(input);
}

export async function setSourceActive(gid: string, active: boolean) {
  await requireOwner();
  return jobs.setSourceActive(gid, active);
}

export async function markSourceChecked(gid: string) {
  await requireOwner();
  return jobs.markSourceChecked(gid);
}

export async function setTracking(gid: string, patch: jobs.TrackingPatch) {
  await requireOwner();
  return jobs.setTracking(gid, patch);
}

export async function addRoleByHand(input: {
  title: string;
  company: string;
  location: string;
  url: string;
  text: string;
}) {
  await requireOwner();
  return jobs.addRoleByHand(input);
}

export async function addEvidence(input: { skill: string; level: number; note: string; url: string }) {
  await requireOwner();
  return jobs.addEvidence(input);
}

export async function removeEvidence(gid: string) {
  await requireOwner();
  return jobs.removeEvidence(gid);
}
