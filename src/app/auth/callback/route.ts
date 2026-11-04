import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

// Where magic links and Google sign-in land. Handles the PKCE code (Google and
// the default email template) and token_hash links (a customised template).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));

  // Supabase sends errors back as query parameters, for example when a Google
  // account has no invited user behind it (sign-ups are off).
  const errorText = `${url.searchParams.get("error_code") ?? ""} ${url.searchParams.get("error_description") ?? ""}`;
  if (url.searchParams.get("error")) {
    return fail(/signup|not allowed/i.test(errorText) ? "not-invited" : "google");
  }

  const supabase = await createClient();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  return ok ? NextResponse.redirect(new URL(next, url.origin)) : fail("link");
}
