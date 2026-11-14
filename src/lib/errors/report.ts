// Turning a raw error into a report that is safe to keep and to show in a
// public GitHub issue (the repository is public), and that groups with every
// other occurrence of the same bug.
//
// Scrubbing removes what could be personal: quoted free text, emails, ids,
// dates, tokens, long numbers, hosts and query strings. It keeps what finds
// the bug: the error type, the wording, code identifiers ('title',
// "tasks_pkey"), the route pattern and the stack frames. Text that is not in
// quotes cannot be told apart from the wording, which is why error messages
// put variable values in quotes.
//
// Used by the server (src/lib/errors/store.ts) and the triage script, so it is
// pure apart from hashing.
import { createHash } from "node:crypto";
import type { Breadcrumb, BrowserContext, BrowserReport } from "./browser.ts";

export type ErrorSource = "server" | "browser" | "connector";

export type ReportInput = {
  source: ErrorSource;
  name: string;
  message: string;
  stack: string;
  /** A browser path, or a route pattern from the server. */
  route: string;
  /** Where it happened: render, action, route, proxy, tool <name>, uncaught, rejection, boundary. */
  context: string;
  release?: string | null;
};

export type ErrorReport = {
  fingerprint: string;
  source: ErrorSource;
  name: string;
  message: string;
  route: string;
  context: string;
  stack: string;
  release: string | null;
};

/** Pages with a dynamic segment. A test checks this against src/app, so a new one cannot leak its slugs. */
export const DYNAMIC_PAGES = ["/lab/[view]", "/life/recipes/[key]", "/progress/[project]"];

const LIMITS = { input: 4000, message: 500, route: 200, context: 60, line: 300, frames: 12, stack: 4000 };

const URL_IN_TEXT = /\bhttps?:\/\/[^\s'"`<>()]+/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DATE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
// A long run of letters and digits mixed: a key, a hash or a JWT part.
const TOKEN_BODY = String.raw`(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{24,}`;
const TOKEN = new RegExp(String.raw`\b${TOKEN_BODY}\b`, "g");
const IS_TOKEN = new RegExp(`^${TOKEN_BODY}$`);
const LONG_NUMBER = /\b\d{4,}\b/g;
// Postgres lists the offending values after the columns: Key (title)=(Chicken curry).
const VALUE_LIST = /\)=\(([^()\n]{0,300})\)/g;
const QUOTED = [
  /(?<!\w)'([^'\n]{0,200})'/g,
  /"([^"\n]{0,200})"/g,
  /`([^`\n]{0,200})`/g,
  /‘([^’\n]{0,200})’/g,
  /“([^”\n]{0,200})”/g,
];
// Quoted text that is code, not a person's words: identifiers, dotted paths,
// kebab-case keys, and error codes in capitals.
const CODE = [/^[a-z_$][\w$.-]{0,59}$/, /^[A-Z][A-Z0-9_]{1,59}$/];

function keepQuoted(content: string): boolean {
  return content.replace(/‹\w+›/g, "").trim() === "" || CODE.some((re) => re.test(content));
}

function cleanSegment(segment: string): string {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    // Keep it encoded; the checks below still apply.
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "[id]";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "[date]";
  if (/^\d+$/.test(s)) return "[n]";
  if (/^\[{1,2}(?:\.\.\.)?[\w-]+\]{1,2}$/.test(s)) return s;
  if (/^[a-z0-9][a-z0-9._-]{0,39}$/i.test(s) && !IS_TOKEN.test(s)) return s;
  return "[text]";
}

/** A browser path as its route pattern: no query string, no slugs, no ids. */
export function routeOf(path: string): string {
  const segments = (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  for (const pattern of DYNAMIC_PAGES) {
    const parts = pattern.split("/").filter(Boolean);
    if (parts.length === segments.length && parts.every((p, i) => p.startsWith("[") || p === segments[i])) {
      return pattern;
    }
  }
  return ("/" + segments.map(cleanSegment).join("/")).slice(0, LIMITS.route);
}

/** Next's route file path (`/life/recipes/[key]/page`) as the URL pattern. */
export function serverRoute(routePath: string): string {
  const segments = routePath.split("/").filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
  if (segments.at(-1) === "page" || segments.at(-1) === "route") segments.pop();
  return "/" + segments.join("/");
}

/** Removes anything in a message that could be personal, and keeps the rest readable. */
export function scrubText(text: string): string {
  let s = text.slice(0, LIMITS.input);
  s = s.replace(URL_IN_TEXT, (url) => {
    try {
      return "‹url›" + routeOf(new URL(url).pathname).replace(/^\/$/, "");
    } catch {
      return "‹url›";
    }
  });
  s = s.replace(EMAIL, "‹email›").replace(UUID, "‹id›").replace(DATE, "‹date›").replace(TOKEN, "‹token›");
  s = s.replace(
    VALUE_LIST,
    (_, values: string) =>
      ")=(" +
      values
        .split(",")
        .map((v) => v.trim())
        .map((v) => (keepQuoted(v) || /^\d{1,3}$/.test(v) ? v : "‹text›"))
        .join(", ") +
      ")",
  );
  for (const re of QUOTED) {
    s = s.replace(re, (whole, content: string) =>
      keepQuoted(content) ? whole : whole.replace(content, () => "‹text›"),
    );
  }
  s = s.replace(LONG_NUMBER, "‹n›").replace(/\s+/g, " ").trim();
  return s.length > LIMITS.message ? s.slice(0, LIMITS.message - 1) + "…" : s;
}

/** The stack's frames, without the message line (which is not scrubbed), hosts or query strings. */
export function stackFrames(stack: string): string {
  return stack
    .split("\n")
    .slice(0, 80)
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line) || /^[^@\s]*@.+:\d+:\d+$/.test(line))
    .filter((line) => !line.includes("node:internal"))
    .map((line) =>
      line
        .replace(/https?:\/\/[^/\s)]+/g, "")
        .replace(/\?[^\s):]*/g, "")
        .replace(/file:\/\//g, "")
        .replace(/\/var\/task\//g, "")
        .replace(EMAIL, "‹email›")
        .replace(UUID, "‹id›")
        .slice(0, LIMITS.line),
    )
    .slice(0, LIMITS.frames)
    .join("\n")
    .slice(0, LIMITS.stack);
}

// Errors that are not the portal's bugs: the network dropping, a tab holding
// chunks from an old deployment, browser quirks and extensions, cancelled
// requests, and Next's own control flow.
const NOISE = [
  /failed to fetch/i,
  /\bload failed\b/i,
  /networkerror/i,
  /network (?:error|connection was lost)/i,
  /\bfetch failed\b/i,
  /chunkloaderror/i,
  /loading (?:css )?chunk [\w-]+ failed/i,
  /resizeobserver loop/i,
  /^script error\.?$/i,
  /aborterror/i,
  /\b(?:user|operation) (?:aborted|was aborted)\b/i,
  /\bECONNRESET\b|\bETIMEDOUT\b|socket hang up/i,
  /^connection closed\.?$/i,
  /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/,
];

export function isNoise(error: { name: string; message: string; stack: string }): boolean {
  if (/(?:chrome|moz|safari(?:-web)?)-extension:\/\//.test(error.stack)) return true;
  return NOISE.some((re) => re.test(error.name) || re.test(error.message));
}

/** Production always reports; ERROR_REPORTING=on turns it on elsewhere, for the end-to-end suite. */
export function reportingEnabled(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === "production" || env.ERROR_REPORTING === "on";
}

/** A bounded, scrubbed report, with a fingerprint that is the same for every occurrence of the bug. */
export function buildReport(input: ReportInput): ErrorReport {
  const name = /^[A-Za-z_$][\w$.]{0,79}$/.test(input.name) ? input.name : "Error";
  const message = scrubText(input.message) || "(no message)";
  const route = routeOf(input.route);
  const context = input.context.replace(/[^\w .:/-]/g, "").slice(0, LIMITS.context) || "unknown";
  const release = input.release && /^[0-9a-f]{7,40}$/.test(input.release) ? input.release : null;
  const fingerprint = createHash("sha256")
    .update([input.source, name, message, route, context].join("\n"), "utf8")
    .digest("hex")
    .slice(0, 32);
  return { fingerprint, source: input.source, name, message, route, context, stack: stackFrames(input.stack), release };
}

const BROWSER_CONTEXTS: BrowserContext[] = ["uncaught", "rejection", "boundary"];

/** The body the browser posts to /api/errors, if it has exactly the right shape. */
export function readBrowserReport(body: unknown): BrowserReport | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const fits = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
  if (!fits(b.name, 200) || !fits(b.message, 4000) || !fits(b.stack, 10_000)) return null;
  if (!fits(b.path, 2000) || !b.path.startsWith("/") || !fits(b.release, 64)) return null;
  if (!BROWSER_CONTEXTS.includes(b.context as BrowserContext)) return null;
  // Optional, and only passed on when sent: their contents are checked by readBreadcrumbs.
  if (b.breadcrumbs !== undefined && (!Array.isArray(b.breadcrumbs) || b.breadcrumbs.length > 30)) return null;
  if (b.viewport !== undefined && !fits(b.viewport, 11)) return null;
  return {
    name: b.name,
    message: b.message,
    stack: b.stack,
    path: b.path,
    context: b.context as BrowserContext,
    release: b.release,
    ...(b.viewport !== undefined && { viewport: b.viewport as string }),
    ...(b.breadcrumbs !== undefined && { breadcrumbs: b.breadcrumbs as Breadcrumb[] }),
  };
}
