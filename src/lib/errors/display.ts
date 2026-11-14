// How an error is described to a person, the same way in a GitHub issue
// (issue.ts) and on the errors page (src/app/errors): where it happened, in
// words, and which of its stack frames are the app's own code. Pure.

export type ErrorSource = "server" | "browser" | "connector";

const SOURCES: Record<ErrorSource, string> = {
  server: "the server",
  browser: "the browser",
  connector: "the Claude connector",
};

const CONTEXTS: Record<string, string> = {
  render: "while rendering",
  action: "in a server action",
  route: "in a route handler",
  proxy: "in the proxy",
  uncaught: "uncaught",
  rejection: "an unhandled promise rejection",
  boundary: "caught by the error page",
  test: "a test from the errors page",
};

/** Where the error came from: "the server", "the browser", "the Claude connector". */
export function sourceLabel(source: string): string {
  return SOURCES[source as ErrorSource] ?? source;
}

/** The connector tool an error happened in, from its context (`tool log_meal`), if any. */
export function toolOf(context: string): string | null {
  return /^tool ([\w-]+)$/.exec(context)?.[1] ?? null;
}

/** What it was doing, in words: "while rendering", "in a server action". */
export function contextLabel(context: string): string {
  const tool = toolOf(context);
  return tool ? `in the connector tool ${tool}` : (CONTEXTS[context] ?? context);
}

/** A stack frame in the app's own code (`src/…:line`), or null for anything else. */
export function appFrame(line: string): { path: string; line: number } | null {
  const match = /(?:^|[\s(@])(src\/[\w./[\]()@-]+):(\d+):\d+\)?$/.exec(line.trim());
  return match ? { path: match[1], line: Number(match[2]) } : null;
}

const URL_SAFE: Record<string, string> = { "[": "%5B", "]": "%5D", "(": "%28", ")": "%29" };

/** The line on GitHub, at the release that ran it. */
export function sourceUrl(repo: string, release: string, frame: { path: string; line: number }): string {
  return `https://github.com/${repo}/blob/${release}/${frame.path.replace(/[[\]()]/g, (c) => URL_SAFE[c])}#L${frame.line}`;
}

/** The device in words: "Chrome 131 on Android 15, phone, 412×915", or null when nothing is known. */
export function deviceLabel(event: {
  browser: string | null;
  os: string | null;
  device: string;
  viewport: string | null;
}): string | null {
  const parts = [
    [event.browser, event.os].filter(Boolean).join(" on "),
    event.device === "unknown" ? "" : event.device,
    event.viewport?.replace("x", "×") ?? "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
