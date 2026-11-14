import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export function proxy(request: NextRequest) {
  // Source maps are for the error tracker, which reads them on the server
  // (src/lib/errors/store.ts). They are never served, so the code stays private
  // even if the repository does not.
  if (request.nextUrl.pathname.endsWith(".map")) return new NextResponse(null, { status: 404 });
  return updateSession(request);
}

export const config = {
  matcher: [
    // exercises/ holds openly licensed drawings for the gym page: no session needed.
    "/((?!_next/static|_next/image|exercises/|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)",
    // The proxy runs before static files, so it can refuse the build's source maps.
    "/_next/static/(.*\\.map)",
  ],
};
