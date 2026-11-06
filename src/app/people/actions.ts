"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/access";
import { isProjectKey } from "@/lib/config/projects";
import { createClient } from "@/lib/supabase/server";

export type PeopleState = { ok?: string; error?: string };

export async function grantMentor(_prev: PeopleState, formData: FormData): Promise<PeopleState> {
  await requireOwner();
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const projects = formData.getAll("projects").map(String).filter(isProjectKey);
  const shareJobHunt = formData.get("share_job_hunt") === "on";
  if (!email || !name) return { error: "Enter their email and name." };
  if (!projects.length) return { error: "Choose at least one project." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("grant_portal_mentor", {
    p_email: email,
    p_display_name: name,
    p_projects: projects,
  });
  if (error) return { error: error.message };
  const shared = await supabase.rpc("set_mentor_share", { p_account: data as string, p_share: "job-hunt", p_on: shareJobHunt });
  if (shared.error) return { error: `Saved their projects, but not the job hunt setting: ${shared.error.message}` };
  revalidatePath("/people");
  return { ok: `${name} can now see ${projects.length} ${projects.length === 1 ? "project" : "projects"}${shareJobHunt ? " and the job hunt" : ""}.` };
}

export async function revokeMember(formData: FormData): Promise<void> {
  await requireOwner();
  const id = String(formData.get("account_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_portal_member", { p_account_id: id });
  if (error) console.error("revoke_portal_member failed", error.message);
  revalidatePath("/people");
}

export async function setJobHuntShare(formData: FormData): Promise<void> {
  await requireOwner();
  const id = String(formData.get("account_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_mentor_share", { p_account: id, p_share: "job-hunt", p_on: formData.get("on") === "true" });
  if (error) console.error("set_mentor_share failed", error.message);
  revalidatePath("/people");
}
