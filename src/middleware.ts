import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // exercises/ holds openly licensed drawings for the gym page: no session needed.
  matcher: ["/((?!_next/static|_next/image|exercises/|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)"],
};
