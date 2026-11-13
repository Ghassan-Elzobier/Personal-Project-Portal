import { NextResponse } from "next/server";
import { ACCESS_TTL_SECONDS, noStore, randomToken, SCOPE, sha256Hex } from "@/lib/connector/oauth";
import { anonClient } from "@/lib/supabase/anon";
import { supabaseConfigured } from "@/lib/supabase/server";

// Token endpoint for the Claude connector. Public client with PKCE; the
// checks (single-use code, client, redirect, verifier, still the owner) are
// in the redeem and refresh RPCs, so they hold even if this route changes.

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: noStore });
}

async function params(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) return oauthError("server_error", "The portal is not configured.", 500);
  const p = await params(request);
  const clientId = p.get("client_id") ?? "";
  if (!clientId) return oauthError("invalid_client", "client_id is required.", 401);

  const access = randomToken();
  const refresh = randomToken();
  const supabase = anonClient();

  let ok: boolean;
  const grant = p.get("grant_type");
  if (grant === "authorization_code") {
    const { data, error } = await supabase.rpc("redeem_mcp_code", {
      p_code_hash: sha256Hex(p.get("code") ?? ""),
      p_code_verifier: p.get("code_verifier") ?? "",
      p_client_id: clientId,
      p_redirect_uri: p.get("redirect_uri") ?? "",
      p_access_hash: sha256Hex(access),
      p_refresh_hash: sha256Hex(refresh),
    });
    if (error) console.error("redeem_mcp_code failed", error.message);
    ok = data === true;
  } else if (grant === "refresh_token") {
    const { data, error } = await supabase.rpc("refresh_mcp_token", {
      p_refresh_hash: sha256Hex(p.get("refresh_token") ?? ""),
      p_client_id: clientId,
      p_access_hash: sha256Hex(access),
      p_new_refresh_hash: sha256Hex(refresh),
    });
    if (error) console.error("refresh_mcp_token failed", error.message);
    ok = data === true;
  } else {
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  if (!ok)
    return oauthError(
      "invalid_grant",
      "The code or refresh token is invalid, used or expired. Connect again from Claude.",
    );
  return NextResponse.json(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: SCOPE,
    },
    { headers: noStore },
  );
}
