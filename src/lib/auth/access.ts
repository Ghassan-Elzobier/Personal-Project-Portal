import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isProjectKey, type ProjectKey } from "../config/projects";
import { createClient } from "../supabase/server";

export type Access = {
  userId: string;
  email: string;
  role: "owner" | "mentor";
  displayName: string;
  projects: ProjectKey[];
};

/**
 * The signed-in account's portal access, from the my_portal_access RPC.
 * Null when signed out or when the account has no access. Cached per request.
 */
export const getAccess = cache(async (): Promise<Access | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("my_portal_access");
  if (error) {
    console.error("my_portal_access failed", error.message);
    return null;
  }
  const row = (data as { role: string; display_name: string; projects: string[] }[] | null)?.[0];
  if (!row || (row.role !== "owner" && row.role !== "mentor")) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    role: row.role,
    displayName: row.display_name,
    projects: (row.projects ?? []).filter(isProjectKey),
  };
});

/** For pages: any account with access, or off to the no-access page. */
export async function requireAccess(): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/no-access");
  return access;
}

/** For owner-only pages and actions. */
export async function requireOwner(): Promise<Access> {
  const access = await requireAccess();
  if (access.role !== "owner") redirect("/");
  return access;
}

export function canRead(access: Access, key: ProjectKey): boolean {
  return access.role === "owner" || access.projects.includes(key);
}
