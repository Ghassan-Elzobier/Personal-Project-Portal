// One occurrence of an error, beyond the error itself: the device it happened
// on, and the last few things the browser did before it (breadcrumbs). Like the
// error, this ends up in a public issue, so it is built from parts the browser
// sends (a route, an element type, a status) and never from text on the page.
// Pure, so it is tested; src/lib/errors/store.ts stores it.
import { DESIGN_CLASSES, type Breadcrumb } from "./browser.ts";
import { routeOf, scrubText } from "./report.ts";

export { DESIGN_CLASSES };

export type Device = { browser: string | null; os: string | null; device: "phone" | "tablet" | "desktop" | "unknown" };

export type StoredBreadcrumb = { at: string; kind: Breadcrumb["kind"]; text: string };

export type ErrorEvent = Device & { viewport: string | null; breadcrumbs: StoredBreadcrumb[] };

const MAX_BREADCRUMBS = 30;

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:A|iOS)?\/(\d+)/, "Edge"],
  [/\bSamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/\bOPR\/(\d+)/, "Opera"],
  [/\b(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/\b(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/\bVersion\/(\d+)[\d.]*.*\bSafari\//, "Safari"],
];

/** Browser, system and kind of device from a user agent. The raw string is never kept. */
export function describeDevice(userAgent: string): Device {
  const ua = userAgent.slice(0, 500);
  let browser: string | null = null;
  for (const [re, name] of BROWSERS) {
    const version = re.exec(ua)?.[1];
    if (version) {
      browser = `${name} ${version}`;
      break;
    }
  }
  const android = /\bAndroid (\d+)/.exec(ua)?.[1];
  const ios = /\b(iPhone|iPad|iPod)\b.*? OS (\d+)_/.exec(ua);
  const os = android
    ? `Android ${android}`
    : ios
      ? `${ios[1] === "iPad" ? "iPadOS" : "iOS"} ${ios[2]}`
      : /\bWindows NT\b/.test(ua)
        ? "Windows"
        : /\bCrOS\b/.test(ua)
          ? "ChromeOS"
          : /\bMac OS X\b/.test(ua)
            ? "macOS"
            : /\bLinux\b/.test(ua)
              ? "Linux"
              : null;
  const device: Device["device"] =
    /\biPad\b|\bTablet\b/.test(ua) || (android && !/\bMobile\b/.test(ua))
      ? "tablet"
      : /\bMobi|\biPhone\b|\biPod\b/.test(ua)
        ? "phone"
        : browser || os
          ? "desktop"
          : "unknown";
  return { browser, os, device };
}

const isPath = (v: unknown): v is string => typeof v === "string" && v.startsWith("/") && v.length <= 2000;
const isInt = (v: unknown, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** One breadcrumb as the sentence that is stored, or null when it is not one the browser could have sent. */
function describe(raw: Record<string, unknown>): string | null {
  switch (raw.kind) {
    case "navigation":
      if (!["load", "push", "replace", "traverse"].includes(raw.how as string) || !isPath(raw.path)) return null;
      return `${raw.how} → ${routeOf(raw.path)}`;
    case "click": {
      if (typeof raw.tag !== "string" || !/^[a-z][a-z0-9-]{0,20}$/.test(raw.tag)) return null;
      const classes = Array.isArray(raw.classes)
        ? raw.classes.filter((c): c is string => DESIGN_CLASSES.includes(c as string)).slice(0, 2)
        : [];
      const name = typeof raw.name === "string" && /^[a-z_][\w-]{0,39}$/.test(raw.name) ? `[name=${raw.name}]` : "";
      const to = isPath(raw.path) ? ` → ${routeOf(raw.path)}` : "";
      return `${raw.tag}${classes.map((c) => `.${c}`).join("")}${name}${to}`;
    }
    case "fetch":
    case "action": {
      if (typeof raw.method !== "string" || !/^[A-Z]{3,7}$/.test(raw.method) || !isPath(raw.path)) return null;
      if (!isInt(raw.status, 599) || !isInt(raw.ms, 600_000)) return null;
      const outcome = `${raw.status || "failed"} (${raw.ms} ms)`;
      if (raw.kind === "action") return `server action on ${routeOf(raw.path)} → ${outcome}`;
      return `${raw.method} ${raw.external === true ? "(other site) " : ""}${routeOf(raw.path)} → ${outcome}`;
    }
    case "console":
      if ((raw.level !== "error" && raw.level !== "warn") || typeof raw.message !== "string") return null;
      return `${raw.level}: ${scrubText(raw.message).slice(0, 200)}`;
    default:
      return null;
  }
}

/** The breadcrumbs a browser sent, checked, worded and scrubbed: the last thirty, oldest first. */
export function readBreadcrumbs(raw: unknown): StoredBreadcrumb[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredBreadcrumb[] = [];
  for (const item of raw.slice(-MAX_BREADCRUMBS * 2)) {
    if (!item || typeof item !== "object") continue;
    const crumb = item as Record<string, unknown>;
    if (typeof crumb.at !== "number" || !Number.isFinite(crumb.at) || crumb.at < 0) continue;
    const text = describe(crumb);
    if (text) out.push({ at: new Date(crumb.at).toISOString(), kind: crumb.kind as Breadcrumb["kind"], text });
  }
  return out.slice(-MAX_BREADCRUMBS);
}

/** The occurrence's own details: device, screen size and breadcrumbs. */
export function buildEvent(input: {
  userAgent?: string | null;
  viewport?: string | null;
  breadcrumbs?: unknown;
}): ErrorEvent {
  return {
    ...describeDevice(input.userAgent ?? ""),
    viewport: input.viewport && /^\d{2,5}x\d{2,5}$/.test(input.viewport) ? input.viewport : null,
    breadcrumbs: readBreadcrumbs(input.breadcrumbs),
  };
}
