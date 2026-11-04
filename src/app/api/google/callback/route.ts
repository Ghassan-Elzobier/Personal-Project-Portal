import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/auth/access";
import { exchangeCode, googleConfigured } from "@/lib/calendar/google";
import { siteOrigin } from "@/lib/config/site";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/calendar/token-crypto";

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Google sends the owner back here after they allow calendar access.
export async function GET(request: NextRequest) {
  const origin = await siteOrigin();
  const back = (result: string) => {
    const response = NextResponse.redirect(new URL(`/schedule?google=${result}`, origin));
    response.cookies.delete({ name: "google_oauth_state", path: "/api/google/callback" });
    return response;
  };

  const access = await getAccess();
  if (access?.role !== "owner" || !googleConfigured()) return back("denied");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("cancelled");
  if (!sameState(request.cookies.get("google_oauth_state")?.value, params.get("state"))) return back("expired");
  const code = params.get("code");
  if (!code) return back("cancelled");

  try {
    const { refreshToken, email } = await exchangeCode(code, `${origin}/api/google/callback`);
    if (!refreshToken) return back("no-refresh-token");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_google_connection", {
      p_refresh_token: encryptToken(refreshToken, process.env.GOOGLE_TOKEN_KEY),
      p_google_email: email ?? "",
    });
    if (error) {
      console.error("set_google_connection failed", error.message);
      return back("failed");
    }
    return back("connected");
  } catch (err) {
    console.error("Google connection failed", err instanceof Error ? err.message : err);
    return back("failed");
  }
}
