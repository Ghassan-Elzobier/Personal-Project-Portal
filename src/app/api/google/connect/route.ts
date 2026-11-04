import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAccess } from "@/lib/auth/access";
import { authUrl, googleConfigured } from "@/lib/calendar/google";
import { siteOrigin } from "@/lib/config/site";

// Starts the one-time Google Calendar connection. Owner only.
export async function GET() {
  const origin = await siteOrigin();
  const access = await getAccess();
  if (access?.role !== "owner") return NextResponse.redirect(new URL("/", origin));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/schedule?google=not-configured", origin));

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authUrl(`${origin}/api/google/callback`, state));
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/google/callback",
    maxAge: 600,
  });
  return response;
}
