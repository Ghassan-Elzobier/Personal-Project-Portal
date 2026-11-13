import { redirectAllowed } from "@/lib/connector/oauth";

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
};

/** Checks an OAuth authorize request. Errors here are shown, never redirected. */
export function parseAuthorize(
  raw: Record<string, string | undefined>,
): { ok: true; value: AuthorizeRequest } | { ok: false; error: string } {
  const redirectUri = raw.redirect_uri ?? "";
  if (!redirectAllowed(redirectUri)) return { ok: false, error: "This sign-in link is not from Claude's connector." };
  if (raw.response_type !== "code") return { ok: false, error: "Unsupported response_type." };
  const clientId = raw.client_id ?? "";
  if (!clientId || clientId.length > 200) return { ok: false, error: "The link has no client id." };
  if (raw.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(raw.code_challenge ?? "")) {
    return { ok: false, error: "The link has no valid PKCE challenge." };
  }
  const state = raw.state ?? null;
  if (state && state.length > 1000) return { ok: false, error: "The link's state is too long." };
  return { ok: true, value: { clientId, redirectUri, codeChallenge: raw.code_challenge!, state } };
}
