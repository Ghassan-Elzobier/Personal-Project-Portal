import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "@/lib/auth/csp";
import { updateSession } from "@/lib/supabase/session";

const CSP = "Content-Security-Policy";

export async function proxy(request: NextRequest) {
  // Source maps are for the error tracker, which reads them on the server
  // (src/lib/errors/store.ts). They are never served, so the code stays private
  // even if the repository does not.
  if (request.nextUrl.pathname.endsWith(".map")) return new NextResponse(null, { status: 404 });

  // Only the portal's own scripts may run (src/lib/auth/csp.ts). The nonce is new for
  // every request. It goes on the request, where Next.js reads it and puts it on the
  // scripts it renders, and on the response, where the browser holds the page to it.
  // Whatever policy a client sent is replaced.
  const policy = contentSecurityPolicy(newNonce(), process.env.NODE_ENV === "development");
  request.headers.set(CSP, policy);
  const response = await updateSession(request);
  response.headers.set(CSP, policy);
  return response;
}

export const config = {
  matcher: [
    // exercises/ holds openly licensed drawings for the gym page: no session needed.
    "/((?!_next/static|_next/image|exercises/|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)",
    // The proxy runs before static files, so it can refuse the build's source maps.
    "/_next/static/(.*\\.map)",
  ],
};
