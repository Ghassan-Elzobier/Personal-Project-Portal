import "server-only";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { rpcAsCaller } from "../supabase/caller";
import { supabaseConfigured } from "../supabase/server";
import { describeError } from "./browser";
import { buildReport, isNoise, reportingEnabled, serverRoute, type ErrorReport, type ReportInput } from "./report";

// Where the portal's errors are kept: report_error, as the caller (a member's
// session or connector token), so access is decided by the database as for
// everything else. The triage workflow files them as GitHub issues.

const TIMEOUT_MS = 3000;

function args(report: ErrorReport) {
  return {
    p_fingerprint: report.fingerprint,
    p_source: report.source,
    p_name: report.name,
    p_message: report.message,
    p_route: report.route,
    p_context: report.context,
    p_stack: report.stack,
    p_release: report.release,
  };
}

// onRequestError runs outside the request's own scope, so the session comes
// from the cookie header it is given rather than from next/headers.
function clientFromCookies(cookieHeader: string) {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => parseCookieHeader(cookieHeader).map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll: () => {},
    },
  });
}

/**
 * Stores a report and says whether it was kept. Never throws and gives up after
 * a few seconds: failing to report an error must not become a second error.
 */
export async function saveReport(report: ErrorReport, cookieHeader?: string): Promise<boolean> {
  if (!reportingEnabled(process.env) || !supabaseConfigured()) return false;
  try {
    const call =
      cookieHeader === undefined
        ? rpcAsCaller("report_error", args(report))
        : clientFromCookies(cookieHeader).rpc("report_error", args(report));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const result = await Promise.race([call, timeout]);
    if (!result) return false;
    if (result.error) {
      console.error("report_error failed", result.error.message);
      return false;
    }
    return result.data !== "dropped";
  } catch (err) {
    console.error("report_error failed", err);
    return false;
  }
}

/** Reports an error the server caught itself: a connector tool that failed, say. */
export async function reportServerError(
  value: unknown,
  where: Pick<ReportInput, "source" | "route" | "context">,
  cookieHeader?: string,
): Promise<void> {
  const described = describeError(value);
  if (isNoise(described)) return;
  await saveReport(buildReport({ ...described, ...where, release: process.env.VERCEL_GIT_COMMIT_SHA }), cookieHeader);
}

type RequestInfo = { path: string; headers: Record<string, string | string[] | undefined> };
type RequestContext = { routePath: string; routeType: string };

/** For instrumentation's onRequestError: a page, route handler, server action or the proxy failed. */
export async function reportRequestError(value: unknown, request: RequestInfo, context: RequestContext) {
  const cookie = request.headers.cookie;
  await reportServerError(
    value,
    { source: "server", route: serverRoute(context.routePath), context: context.routeType },
    Array.isArray(cookie) ? cookie.join("; ") : (cookie ?? ""),
  );
}
