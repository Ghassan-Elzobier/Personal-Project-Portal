// The browser's half of error tracking: remember the last few things that
// happened (breadcrumbs), describe what was thrown, and send both to
// /api/errors, which checks, scrubs and stores them (src/lib/errors/). It runs
// before React hydrates (src/instrumentation-client.ts), so it stays small and
// imports nothing.
//
// Breadcrumbs are built from parts, never from text on the page: a route, an
// element type and its design class, a request's method and status.

export type BrowserContext = "uncaught" | "rejection" | "boundary";

export type Breadcrumb =
  | { at: number; kind: "navigation"; how: "load" | "push" | "replace" | "traverse"; path: string }
  | { at: number; kind: "click"; tag: string; classes: string[]; name?: string; path?: string }
  | {
      at: number;
      kind: "fetch" | "action";
      method: string;
      path: string;
      external?: boolean;
      status: number;
      ms: number;
    }
  | { at: number; kind: "console"; level: "error" | "warn"; message: string };

/** What the browser sends. The server trusts none of it: see readBrowserReport and readBreadcrumbs. */
export type BrowserReport = {
  name: string;
  message: string;
  stack: string;
  path: string;
  context: BrowserContext;
  release: string;
  viewport?: string;
  breadcrumbs?: Breadcrumb[];
};

/** The design system's interactive classes (src/app/globals.css): the only classes a click names. */
export const DESIGN_CLASSES = [
  "btn",
  "btn-ghost",
  "btn-life",
  "btn-primary",
  "btn-soft",
  "card",
  "card-life",
  "card-link",
  "card-special",
  "chip",
  "field-input",
  "link",
  "tap",
];

const MAX_BREADCRUMBS = 30;
const crumbs: Breadcrumb[] = [];

function remember(crumb: Breadcrumb): void {
  crumbs.push(crumb);
  if (crumbs.length > MAX_BREADCRUMBS) crumbs.shift();
}

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

/** A navigation: the first page load, or a move the App Router makes (onRouterTransitionStart). */
export function recordNavigation(url: string, how: "load" | "push" | "replace" | "traverse"): void {
  try {
    remember({ at: Date.now(), kind: "navigation", how, path: new URL(url, window.location.href).pathname });
  } catch {
    // Not a URL we can read; skip it.
  }
}

const INTERACTIVE = "a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab]";

function recordClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
  if (!target) return;
  const crumb: Breadcrumb = {
    at: Date.now(),
    kind: "click",
    tag: target.tagName.toLowerCase(),
    classes: [...target.classList].filter((c) => DESIGN_CLASSES.includes(c)),
  };
  const name = target.getAttribute("name");
  if (name) crumb.name = name.slice(0, 40);
  if (target instanceof HTMLAnchorElement && target.origin === window.location.origin) crumb.path = target.pathname;
  remember(crumb);
}

// Every request the page makes, except the router's own page loads (they are
// navigations) and the error reports themselves. The real fetch is kept when
// tracking starts; nothing here touches window until then, since this module
// is also loaded on the server and in tests.
let realFetch: typeof fetch | null = null;
const plainFetch: typeof fetch = (input, init) => (realFetch ?? fetch)(input, init);

async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let crumb: Extract<Breadcrumb, { kind: "fetch" | "action" }> | null = null;
  const started = performance.now();
  try {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), window.location.href);
    const headers = new Headers(init?.headers ?? request?.headers);
    if (url.pathname !== "/api/errors" && !headers.has("rsc") && !url.searchParams.has("_rsc")) {
      crumb = {
        at: Date.now(),
        kind: headers.has("next-action") ? "action" : "fetch",
        method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
        path: url.pathname,
        status: 0,
        ms: 0,
      };
      if (url.origin !== window.location.origin) crumb.external = true;
    }
  } catch {
    crumb = null;
  }
  try {
    const response = await plainFetch(input, init);
    if (crumb) crumb.status = response.status;
    return response;
  } finally {
    if (crumb) {
      crumb.ms = Math.round(performance.now() - started);
      remember(crumb);
    }
  }
}

function trackConsole(level: "error" | "warn"): void {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    try {
      const first = args[0];
      const message = first instanceof Error ? `${first.name}: ${first.message}` : text(first);
      remember({ at: Date.now(), kind: "console", level, message: message.slice(0, 500) });
    } catch {
      // Keep logging even if this one cannot be remembered.
    }
    original(...args);
  };
}

let started = false;

/** Starts remembering breadcrumbs. Called once, before the app hydrates. */
export function startBreadcrumbs(): void {
  if (started || process.env.NODE_ENV !== "production") return;
  started = true;
  try {
    recordNavigation(window.location.href, "load");
    document.addEventListener("click", recordClick, { capture: true, passive: true });
    realFetch = window.fetch.bind(window);
    window.fetch = trackedFetch;
    trackConsole("error");
    trackConsole("warn");
  } catch {
    // Breadcrumbs are a help, not a requirement.
  }
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
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      breadcrumbs: crumbs.slice(),
    };
    void plainFetch("/api/errors", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {});
  } catch {
    // Nothing to do: the error is still in the console.
  }
}
