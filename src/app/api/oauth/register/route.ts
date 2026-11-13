import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clientLabel, noStore, redirectAllowed } from "@/lib/connector/oauth";

// Dynamic client registration (RFC 7591), as Claude's connector expects.
// Nothing is stored: a client is only ever as good as its redirect URI, and
// only Claude's callback is accepted, so the id is just a label.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const uris = Array.isArray(body?.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (!uris.length || !uris.every(redirectAllowed)) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "Only Claude's connector callback can register." },
      { status: 400, headers: noStore },
    );
  }
  return NextResponse.json(
    {
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: typeof body?.client_name === "string" ? body.client_name.slice(0, 200) : clientLabel(uris[0]),
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: noStore },
  );
}
