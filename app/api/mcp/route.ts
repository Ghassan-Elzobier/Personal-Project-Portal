import { NextResponse } from "next/server";
import { runAsConnector } from "@/lib/connector/context";
import { anonClient, noStore, origin, sha256Hex } from "@/lib/connector/oauth";
import { INSTRUCTIONS, TOOLS } from "@/lib/connector/tools";
import { supabaseConfigured } from "@/lib/supabase/server";

// The Claude connector: a Model Context Protocol server over Streamable HTTP,
// stateless, answering each JSON-RPC POST with plain JSON. Claude's app signs
// in with OAuth (see /.well-known/oauth-authorization-server); every call
// needs a live access token that belongs to the owner.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function unauthorized(request: Request) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to the portal from Claude's connector settings." } },
    {
      status: 401,
      headers: {
        ...noStore,
        "WWW-Authenticate": `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

async function caller(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header)?.[1];
  if (!token || !supabaseConfigured()) return null;
  const { data, error } = await anonClient().rpc("mcp_session", { p_access_hash: sha256Hex(token) });
  if (error) {
    console.error("mcp_session failed", error.message);
    return null;
  }
  const row = (data as { account_id: string; google_refresh_token: string | null; google_email: string | null; google_connected_at: string | null }[] | null)?.[0];
  if (!row) return null;
  return {
    accountId: row.account_id,
    google: row.google_refresh_token
      ? { sealed: row.google_refresh_token, email: row.google_email, connectedAt: row.google_connected_at ?? "" }
      : null,
  };
}

async function handle(msg: RpcRequest, base: string): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });

  // Notifications (no id) get no answer.
  if (msg.id === undefined || msg.id === null) return null;

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "personal-project-portal", title: "Personal Project Portal", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { title, ...annotations },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(msg.params?.name)}`);
      const args = msg.params?.arguments;
      try {
        const result = await tool.run(args && typeof args === "object" ? (args as Record<string, unknown>) : {}, { base });
        return reply({ content: [{ type: "text", text: result.text }], isError: result.isError ?? false });
      } catch (err) {
        console.error(`tool ${tool.name} failed`, err);
        return reply({ content: [{ type: "text", text: "The portal hit an error running that. Try again, or use the page." }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(request: Request) {
  const who = await caller(request);
  if (!who) return unauthorized(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const base = origin(request);
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (!messages.length || messages.some((m) => !m || typeof m !== "object" || typeof m.method !== "string")) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
  }

  const replies = await runAsConnector(who, async () => {
    const out: object[] = [];
    for (const m of messages) {
      const r = await handle(m, base);
      if (r) out.push(r);
    }
    return out;
  });

  if (!replies.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? replies : replies[0], { headers: noStore });
}

// No server-to-client stream and no sessions to end.
export function GET() {
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
