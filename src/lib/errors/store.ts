import "server-only";
import { readFileSync, statSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { rpcAsCaller } from "../supabase/caller";
import { supabaseConfigured } from "../supabase/server";
import { describeError } from "./browser";
import { buildEvent, type ErrorEvent } from "./events";
import { buildReport, isNoise, reportingEnabled, serverRoute, type ErrorReport, type ReportInput } from "./report";
import { mapFiles, symbolicateStack } from "./symbolicate";

// Where the portal's errors are kept: record_error, as the caller (a member's
// session or connector token), so access is decided by the database as for
// everything else. Each occurrence is kept with its device and breadcrumbs, and
// its stack is mapped back to source lines first. The triage workflow files
// the bugs as GitHub issues.

const TIMEOUT_MS = 3000;

// The build's source maps, read from the server's own bundle, with the source
// text stripped out. scripts/pack-source-maps.mjs decides which maps each
// function ships with, so the build must not trace these reads itself: without
// the ignore comment, Turbopack would deploy the whole project with every
// function. Parsed maps are kept for the life of the instance, a few dozen at most.
const MAX_MAPS = 24;
const MAX_MAP_BYTES = 40_000_000;
const maps = new Map<string, SourceMap | null>();

function lookupMap(file: string): SourceMap | null {
  const cached = maps.get(file);
  if (cached !== undefined) return cached;
  let map: SourceMap | null = null;
  for (const path of mapFiles(file).map((name) => join(/*turbopackIgnore: true*/ process.cwd(), name))) {
    try {
      if (statSync(path).size > MAX_MAP_BYTES) break;
      map = new SourceMap(JSON.parse(readFileSync(path, "utf8")));
      break;
    } catch {
      // Not here; try the next place.
    }
  }
  if (maps.size >= MAX_MAPS) maps.delete(maps.keys().next().value as string);
  maps.set(file, map);
  return map;
}

/** The stack with each frame mapped back to its source line, where the build's maps allow. */
export function readableStack(stack: string): string {
  try {
    return symbolicateStack(stack.slice(0, 20_000), lookupMap);
  } catch {
    return stack;
  }
}

function args(report: ErrorReport, event: ErrorEvent) {
  return {
    p_fingerprint: report.fingerprint,
    p_source: report.source,
    p_name: report.name,
    p_message: report.message,
    p_route: report.route,
    p_context: report.context,
    p_stack: report.stack,
    p_release: report.release,
    p_browser: event.browser,
    p_os: event.os,
    p_device: event.device,
    p_viewport: event.viewport,
    p_breadcrumbs: event.breadcrumbs,
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
 * Stores an occurrence and says whether it was kept. Never throws and gives up
 * after a few seconds: failing to report an error must not become a second error.
 */
export async function saveReport(report: ErrorReport, event: ErrorEvent, cookieHeader?: string): Promise<boolean> {
  if (!reportingEnabled(process.env) || !supabaseConfigured()) return false;
  try {
    const call =
      cookieHeader === undefined
        ? rpcAsCaller("record_error", args(report, event))
        : clientFromCookies(cookieHeader).rpc("record_error", args(report, event));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const result = await Promise.race([call, timeout]);
    if (!result) return false;
    if (result.error) {
      console.error("record_error failed", result.error.message);
      return false;
    }
    return result.data !== "dropped";
  } catch (err) {
    console.error("record_error failed", err);
    return false;
  }
}

/** Reports an error the server caught itself: a connector tool that failed, say. */
export async function reportServerError(
  value: unknown,
  where: Pick<ReportInput, "source" | "route" | "context">,
  from: { cookieHeader?: string; userAgent?: string } = {},
): Promise<void> {
  const described = describeError(value);
  if (isNoise(described)) return;
  const report = buildReport({
    ...described,
    stack: readableStack(described.stack),
    ...where,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  await saveReport(report, buildEvent({ userAgent: from.userAgent }), from.cookieHeader);
}

type RequestInfo = { path: string; headers: Record<string, string | string[] | undefined> };
type RequestContext = { routePath: string; routeType: string };

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join("; ") : (value ?? ""));

/** For instrumentation's onRequestError: a page, route handler, server action or the proxy failed. */
export async function reportRequestError(value: unknown, request: RequestInfo, context: RequestContext) {
  await reportServerError(
    value,
    { source: "server", route: serverRoute(context.routePath), context: context.routeType },
    { cookieHeader: header(request.headers.cookie), userAgent: header(request.headers["user-agent"]) },
  );
}
