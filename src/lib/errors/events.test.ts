import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_CLASSES, buildEvent, describeDevice, readBreadcrumbs } from "./events.ts";
import { readBrowserReport, scrubText } from "./report.ts";

// Made-up devices and actions. Like the error itself, what led up to it ends up
// in a public issue, so nothing here may carry a person's words.

const AT = Date.parse("2026-11-14T09:30:00Z");

test("describeDevice names the browser, the system and the kind of device", () => {
  const pixel =
    "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  assert.deepEqual(describeDevice(pixel), { browser: "Chrome 131", os: "Android 15", device: "phone" });
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  assert.deepEqual(describeDevice(iphone), { browser: "Safari 18", os: "iOS 18", device: "phone" });
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
  assert.deepEqual(describeDevice(mac), { browser: "Edge 131", os: "macOS", device: "desktop" });
  const firefox = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
  assert.deepEqual(describeDevice(firefox), { browser: "Firefox 133", os: "Windows", device: "desktop" });
  const tablet =
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  assert.equal(describeDevice(tablet).device, "tablet");
  assert.deepEqual(describeDevice("node-fetch/1.0"), { browser: null, os: null, device: "unknown" });
  assert.deepEqual(describeDevice(""), { browser: null, os: null, device: "unknown" });
});

test("readBreadcrumbs words each action from its parts, never from page text", () => {
  const crumbs = readBreadcrumbs([
    { at: AT, kind: "navigation", how: "load", path: "/life" },
    {
      at: AT + 1000,
      kind: "click",
      tag: "a",
      classes: ["card-link", "flex", "gap-2"],
      path: "/life/recipes/chicken-curry",
    },
    { at: AT + 2000, kind: "click", tag: "button", classes: ["btn-primary"], name: "weight" },
    { at: AT + 3000, kind: "action", method: "POST", path: "/life/body", status: 500, ms: 182 },
    {
      at: AT + 4000,
      kind: "fetch",
      method: "GET",
      path: "/rest/v1/rpc/my_portal_access",
      external: true,
      status: 0,
      ms: 30,
    },
    {
      at: AT + 5000,
      kind: "console",
      level: "error",
      message: "Could not save 'Morning weigh-in' for someone@example.test",
    },
    { at: AT + 6000, kind: "navigation", how: "push", path: "/schedule/2026-11-14?view=week" },
  ]);
  assert.deepEqual(
    crumbs.map((c) => c.text),
    [
      "load → /life",
      "a.card-link → /life/recipes/[key]",
      "button.btn-primary[name=weight]",
      "server action on /life/body → 500 (182 ms)",
      "GET (other site) /rest/v1/rpc/my_portal_access → failed (30 ms)",
      "error: Could not save '‹text›' for ‹email›",
      "push → /schedule/[date]",
    ],
  );
  assert.deepEqual(
    crumbs.map((c) => c.kind),
    ["navigation", "click", "click", "action", "fetch", "console", "navigation"],
  );
  assert.equal(crumbs[0].at, "2026-11-14T09:30:00.000Z");
});

test("readBreadcrumbs drops anything malformed and keeps the last thirty", () => {
  assert.deepEqual(readBreadcrumbs("nope"), []);
  assert.deepEqual(
    readBreadcrumbs([
      { at: AT, kind: "teleport", path: "/" },
      { at: "yesterday", kind: "navigation", how: "push", path: "/" },
      { at: AT, kind: "navigation", how: "push", path: "life" },
      { at: AT, kind: "click", tag: "<script>", classes: [] },
      { at: AT, kind: "fetch", method: "get", path: "/x", status: 200, ms: 1 },
      { at: AT, kind: "click", tag: "button", classes: [], name: "Alex Example" },
    ]).map((c) => c.text),
    ["button"],
  );
  const many = Array.from({ length: 50 }, (_, i) => ({ at: AT + i, kind: "navigation", how: "push", path: `/p${i}` }));
  const kept = readBreadcrumbs(many);
  assert.equal(kept.length, 30);
  assert.equal(kept.at(-1)?.text, "push → /p49");
});

test("DESIGN_CLASSES are the design system's own classes, so a click names a real one", () => {
  const css = readFileSync(join(import.meta.dirname, "../../app/globals.css"), "utf8");
  for (const name of DESIGN_CLASSES) assert.match(css, new RegExp(`@utility ${name} \\{`), name);
});

test("buildEvent describes where it happened without keeping the raw user agent", () => {
  const event = buildEvent({
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: "412x915",
    breadcrumbs: [{ at: AT, kind: "navigation", how: "load", path: "/" }],
  });
  assert.deepEqual(event, {
    browser: "Chrome 131",
    os: "Android 15",
    device: "phone",
    viewport: "412x915",
    breadcrumbs: [{ at: "2026-11-14T09:30:00.000Z", kind: "navigation", text: "load → /" }],
  });
  assert.equal(buildEvent({ viewport: "huge" }).viewport, null);
  assert.deepEqual(buildEvent({}).breadcrumbs, []);
});

test("readBrowserReport passes breadcrumbs and the viewport through when the browser sends them", () => {
  const sent = {
    name: "TypeError",
    message: "boom",
    stack: "",
    path: "/life",
    context: "uncaught",
    release: "",
    viewport: "412x915",
    breadcrumbs: [{ at: AT, kind: "navigation", how: "load", path: "/" }],
  };
  assert.deepEqual(readBrowserReport(sent), sent);
  assert.equal(readBrowserReport({ ...sent, breadcrumbs: "lots" }), null);
  assert.equal(readBrowserReport({ ...sent, breadcrumbs: Array(31).fill(sent.breadcrumbs[0]) }), null);
  assert.equal(readBrowserReport({ ...sent, viewport: 412 }), null);
});

test("scrubText removes the values Postgres lists after the columns, and keeps code-like ones", () => {
  assert.equal(
    scrubText(
      'duplicate key value violates unique constraint "meals_pkey" Key (title, day)=(Chicken curry, 2026-11-14)',
    ),
    'duplicate key value violates unique constraint "meals_pkey" Key (title, day)=(‹text›, ‹date›)',
  );
  assert.equal(scrubText("Key (kind)=(lunch) is not present"), "Key (kind)=(lunch) is not present");
});
