import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// The connector endpoints check their own bearer tokens; the browser session
// does not apply to them.
const CONNECTOR_PATHS = ["/api/mcp", "/api/oauth/", "/.well-known/"];
const PUBLIC_PATHS = ["/login", "/auth/", "/manifest.webmanifest", ...CONNECTOR_PATHS];

/** Refreshes the Supabase session cookie and sends signed-out visitors to /login. */
export async function updateSession(request: NextRequest) {
  if (CONNECTOR_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!url || !key) {
    // Not configured yet: let /login explain what is missing.
    return isPublic ? response : NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Checks the token's signature here rather than asking Supabase on every
  // request, including each link the browser prefetches. It still refreshes an
  // expired session. Access itself is decided by the database on every read.
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub && !isPublic) {
    const login = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  return response;
}
