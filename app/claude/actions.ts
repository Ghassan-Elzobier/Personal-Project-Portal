"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export async function disconnectClaude(): Promise<void> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_mcp_connections");
  if (error) console.error("revoke_mcp_connections failed", error.message);
  revalidatePath("/claude");
}
