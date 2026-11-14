// The browser's half of error tracking: describe what was thrown and send it
// to /api/errors, which scrubs and stores it (src/lib/errors/report.ts). It runs
// before React hydrates (src/instrumentation-client.ts), so it stays tiny and
// imports nothing.

export type BrowserContext = "uncaught" | "rejection" | "boundary";

/** What the browser sends. The server trusts none of it: see readBrowserReport. */
export type BrowserReport = {
  name: string;
  message: string;
  stack: string;
  path: string;
  context: BrowserContext;
  release: string;
};

function text(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "(unprintable)";
  }
}

/** Name, message and stack of anything that can be thrown, not only an Error. */
export function describeError(value: unknown): { name: string; message: string; stack: string } {
  if (value instanceof Error) {
    return { name: value.name || "Error", message: text(value.message), stack: text(value.stack ?? "") };
  }
  if (value && typeof value === "object" && "message" in value) {
    const shaped = value as { name?: unknown; message: unknown; stack?: unknown };
    return {
      name: typeof shaped.name === "string" ? shaped.name : "Error",
      message: text(shaped.message),
      stack: typeof shaped.stack === "string" ? shaped.stack : "",
    };
  }
  return { name: "Error", message: text(value), stack: "" };
}

// One report per distinct error, and at most ten per page load, so a render
// loop cannot flood the endpoint.
const sent = new Set<string>();
const MAX_PER_PAGE = 10;

/** Reports an error from the browser. Never throws: reporting must not cause a second error. */
export function sendErrorReport(value: unknown, context: BrowserContext): void {
  if (process.env.NODE_ENV !== "production") return;
  try {
    const { name, message, stack } = describeError(value);
    const key = `${name}:${message}`;
    if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
    sent.add(key);
    const report: BrowserReport = {
      name: name.slice(0, 200),
      message: message.slice(0, 4000),
      stack: stack.slice(0, 10_000),
      path: window.location.pathname.slice(0, 2000),
      context,
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "",
    };
    void fetch("/api/errors", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {});
  } catch {
    // Nothing to do: the error is still in the console.
  }
}
