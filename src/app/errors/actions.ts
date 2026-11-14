"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/access";
import { reportServerError } from "@/lib/errors/store";
import { createClient } from "@/lib/supabase/server";

const FINGERPRINT = /^[0-9a-f]{32}$/;

/** Ignores a bug or restores it. The triage then closes or reopens its GitHub issue. */
export async function setIgnored(fingerprint: string, ignored: boolean): Promise<{ error?: string }> {
  await requireOwner();
  if (!FINGERPRINT.test(fingerprint)) return { error: "That is not an error the portal knows." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_error_ignored", { p_fingerprint: fingerprint, p_ignored: ignored });
  if (error) return { error: error.message };
  revalidatePath("/errors");
  revalidatePath(`/errors/${fingerprint}`);
  return {};
}

/**
 * The errors page's check: a real error thrown here and sent through the real
 * pipeline, stack mapping included. Test errors are never filed as issues.
 * Says whether it was stored; only production stores errors.
 */
export async function sendServerTestError(): Promise<{ stored: boolean }> {
  await requireOwner();
  let stored = false;
  try {
    throw new Error("Test error from the errors page (server)");
  } catch (error) {
    stored = await reportServerError(error, { source: "server", route: "/errors", context: "test" });
  }
  revalidatePath("/errors");
  return { stored };
}
