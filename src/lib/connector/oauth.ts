import "server-only";
import { createHash, randomBytes } from "node:crypto";

// OAuth 2.1 for the Claude connector: public clients, PKCE S256 only, and a
// fixed list of redirect URIs (Claude's callback), so registering a client
// grants nothing by itself. Codes and tokens are random 32-byte strings; only
// their SHA-256 hashes reach the database.

export const SCOPE = "portal";
export const ACCESS_TTL_SECONDS = 3600;

const CLAUDE_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Claude's callbacks, any in MCP_EXTRA_REDIRECT_URIS, and localhost under `next dev`. */
export function redirectAllowed(uri: string): boolean {
  const extra = (process.env.MCP_EXTRA_REDIRECT_URIS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (CLAUDE_CALLBACKS.includes(uri) || extra.includes(uri)) return true;
  if (process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(uri);
      return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    } catch {
      return false;
    }
  }
  return false;
}

/** A label for the connected-apps list, from where the redirect goes. */
export function clientLabel(redirectUri: string): string {
  try {
    const host = new URL(redirectUri).hostname;
    return host === "claude.ai" || host === "claude.com" ? "Claude" : host;
  } catch {
    return "Unknown app";
  }
}

export function origin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Personal Project Portal",
  };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

export const noStore = { "Cache-Control": "no-store" };
