"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { clientLabel, randomToken, sha256Hex } from "@/lib/connector/oauth";
import { siteOrigin } from "@/lib/config/site";
import { createClient } from "@/lib/supabase/server";
import { parseAuthorize } from "./request";

function back(redirectUri: string, params: Record<string, string | null>): never {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  redirect(url.toString());
}

export async function decide(formData: FormData): Promise<void> {
  await requireOwner();
  const req = parseAuthorize(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
  if (!req.ok) redirect("/claude?error=link");
  const { clientId, redirectUri, codeChallenge, state } = req.value;
  const iss = await siteOrigin();

  if (formData.get("decision") !== "allow") back(redirectUri, { error: "access_denied", state, iss });

  const code = randomToken();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_mcp_code", {
    p_code_hash: sha256Hex(code),
    p_client_id: clientId,
    p_client_name: clientLabel(redirectUri),
    p_redirect_uri: redirectUri,
    p_code_challenge: codeChallenge,
  });
  if (error) {
    console.error("create_mcp_code failed", error.message);
    back(redirectUri, { error: "server_error", state, iss });
  }
  back(redirectUri, { code, state, iss });
}
