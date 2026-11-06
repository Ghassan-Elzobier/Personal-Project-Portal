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

type Check = { access: Access | null; failed: string | null };

/**
 * The signed-in account's portal access, from the my_portal_access RPC, or the reason
 * the check itself failed. Cached per request.
 */
const checkAccess = cache(async (): Promise<Check> => {
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getClaims();
  const claims = session?.claims;
  if (!claims?.sub) return { access: null, failed: null };

  const { data, error } = await supabase.rpc("my_portal_access");
  if (error) {
    console.error("my_portal_access failed", error.message);
    return { access: null, failed: error.message };
  }
  const row = (data as { role: string; display_name: string; projects: string[] }[] | null)?.[0];
  if (!row || (row.role !== "owner" && row.role !== "mentor")) return { access: null, failed: null };

  return {
    access: {
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : "",
      role: row.role,
      displayName: row.display_name,
      projects: (row.projects ?? []).filter(isProjectKey),
    },
    failed: null,
  };
});

/** The signed-in account's access. Null when signed out, without access, or when the check failed. */
export async function getAccess(): Promise<Access | null> {
  return (await checkAccess()).access;
}

/**
 * For pages: any account with access, or off to the no-access page. A check that
 * failed is not the same as no access, so it shows the error page and its Try again
 * button instead of telling the owner they are not set up.
 */
export async function requireAccess(): Promise<Access> {
  const { access, failed } = await checkAccess();
  if (failed) throw new Error(`Could not check your access to the portal: ${failed}`);
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
