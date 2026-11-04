"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/access";
import { isProjectKey } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

export type PeopleState = { ok?: string; error?: string };

export async function grantMentor(_prev: PeopleState, formData: FormData): Promise<PeopleState> {
  await requireOwner();
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const projects = formData.getAll("projects").map(String).filter(isProjectKey);
  if (!email || !name) return { error: "Enter their email and name." };
  if (!projects.length) return { error: "Choose at least one project." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_portal_mentor", {
    p_email: email,
    p_display_name: name,
    p_projects: projects,
  });
  if (error) return { error: error.message };
  revalidatePath("/people");
  return { ok: `${name} can now see ${projects.length} ${projects.length === 1 ? "project" : "projects"}.` };
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
