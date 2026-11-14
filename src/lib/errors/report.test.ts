import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describeError } from "./browser.ts";
import {
  DYNAMIC_PAGES,
  buildReport,
  isNoise,
  readBrowserReport,
  reportingEnabled,
  routeOf,
  scrubText,
  serverRoute,
  stackFrames,
} from "./report.ts";

// Every message here is made up. The scrubber exists because the issues it
// feeds are public: anything that might be personal must not survive it.

test("scrubText keeps code identifiers so the bug can still be found", () => {
  assert.equal(
    scrubText("Cannot read properties of undefined (reading 'title')"),
    "Cannot read properties of undefined (reading 'title')",
  );
  assert.equal(
    scrubText('duplicate key value violates unique constraint "tasks_pkey"'),
    'duplicate key value violates unique constraint "tasks_pkey"',
  );
  assert.equal(scrubText("Unknown recipe 'chicken-curry'"), "Unknown recipe 'chicken-curry'");
  assert.equal(scrubText("Supabase said 'PGRST116'"), "Supabase said 'PGRST116'");
  assert.equal(scrubText("x is not a function (at 'state.meals.map')"), "x is not a function (at 'state.meals.map')");
});

test("scrubText removes quoted free text, emails, ids, dates, tokens and long numbers", () => {
  assert.equal(scrubText("No meal called 'Chicken curry with rice'"), "No meal called '‹text›'");
  assert.equal(scrubText('Mentor "Alex" has no projects'), 'Mentor "‹text›" has no projects');
  assert.equal(scrubText("Could not invite someone@example.test"), "Could not invite ‹email›");
  assert.equal(scrubText("Task 3f1c2a9e-1b2c-4d5e-8f90-123456789abc not found"), "Task ‹id› not found");
  assert.equal(
    scrubText("Key (account_id, day)=(3f1c2a9e-1b2c-4d5e-8f90-123456789abc, 2026-11-14) already exists."),
    "Key (account_id, day)=(‹id›, ‹date›) already exists.",
  );
  assert.equal(scrubText("Expired at 2026-11-14T09:30:00.000Z"), "Expired at ‹date›");
  assert.equal(scrubText("Bad token eyJhbGciOiJIUzI1NiJ9abcdefghijk1234"), "Bad token ‹token›");
  assert.equal(scrubText("token 'abcdef0123456789abcdef0123456789' rejected"), "token '‹token›' rejected");
  assert.equal(scrubText("Digest 2390487234 failed after 3 tries"), "Digest ‹n› failed after 3 tries");
  assert.equal(scrubText("Request failed with status 500"), "Request failed with status 500");
});

test("scrubText reads apostrophes in prose as words, not quotes", () => {
  assert.equal(scrubText("Can't find 'title' in the owner's plan"), "Can't find 'title' in the owner's plan");
});

test("scrubText keeps the path of a URL and drops its host and query string", () => {
  assert.equal(
    scrubText("fetch https://abc.supabase.co/rest/v1/rpc/report_error?apikey=secret failed"),
    "fetch ‹url›/rest/v1/rpc/report_error failed",
  );
  assert.equal(scrubText("GET https://example.test/life/recipes/My%20Soup"), "GET ‹url›/life/recipes/[key]");
});

test("scrubText collapses whitespace and caps the length", () => {
  assert.equal(scrubText("  two\n\tlines  "), "two lines");
  const long = scrubText("x".repeat(5000));
  assert.ok(long.length <= 500);
  assert.ok(long.endsWith("…"));
});

test("routeOf turns a browser path into its route pattern", () => {
  assert.equal(routeOf("/"), "/");
  assert.equal(routeOf("/life?day=2026-11-14#top"), "/life");
  assert.equal(routeOf("/life/recipes/chicken-curry"), "/life/recipes/[key]");
  assert.equal(routeOf("/progress/pmpp"), "/progress/[project]");
  assert.equal(routeOf("/schedule/2026-11-14"), "/schedule/[date]");
  assert.equal(routeOf("/tasks/12345"), "/tasks/[n]");
  assert.equal(routeOf("/x/3f1c2a9e-1b2c-4d5e-8f90-123456789abc"), "/x/[id]");
  assert.equal(routeOf("/people/Alex%20Example"), "/people/[text]");
});

test("DYNAMIC_PAGES lists every dynamic page in src/app, so no slug reaches an issue", () => {
  const found: string[] = [];
  const walk = (dir: string, route: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "api") continue;
        const groups = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(join(dir, entry.name), groups ? route : [...route, entry.name]);
      } else if (entry.name === "page.tsx" && route.some((s) => s.startsWith("["))) {
        found.push("/" + route.join("/"));
      }
    }
  };
  walk(join(import.meta.dirname, "../../app"), []);
  assert.deepEqual([...DYNAMIC_PAGES].sort(), found.sort());
});

test("serverRoute turns Next's route file path into the URL pattern", () => {
  assert.equal(serverRoute("/life/recipes/[key]/page"), "/life/recipes/[key]");
  assert.equal(serverRoute("/api/mcp/route"), "/api/mcp");
  assert.equal(serverRoute("/page"), "/");
  assert.equal(serverRoute("/(main)/week/page"), "/week");
  assert.equal(serverRoute("/proxy"), "/proxy");
  assert.equal(serverRoute(""), "/");
});

test("stackFrames keeps the frames, without the message line, hosts or query strings", () => {
  const v8 = [
    "TypeError: Cannot read properties of undefined (reading 'title') for someone@example.test",
    "    at MealCard (https://portal.example.test/_next/static/chunks/0abc.js?dpl=dpl_123:1:2345)",
    "    at renderWithHooks (/var/task/node_modules/react-dom/cjs/react-dom.js:10:20)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
  ].join("\n");
  assert.equal(
    stackFrames(v8),
    [
      "at MealCard (/_next/static/chunks/0abc.js:1:2345)",
      "at renderWithHooks (node_modules/react-dom/cjs/react-dom.js:10:20)",
    ].join("\n"),
  );
  const safari = "MealCard@https://portal.example.test/_next/static/chunks/0abc.js:1:2345\nglobal code@";
  assert.equal(stackFrames(safari), "MealCard@/_next/static/chunks/0abc.js:1:2345");
  assert.equal(stackFrames(""), "");
  assert.equal(
    stackFrames(Array.from({ length: 40 }, (_, i) => `    at f${i} (a.js:${i}:1)`).join("\n")).split("\n").length,
    12,
  );
});

test("isNoise drops errors that are not the portal's bugs", () => {
  const noise = (name: string, message: string, stack = "") => isNoise({ name, message, stack });
  assert.equal(noise("TypeError", "Failed to fetch"), true);
  assert.equal(noise("TypeError", "Load failed"), true);
  assert.equal(noise("TypeError", "fetch failed"), true);
  assert.equal(noise("ChunkLoadError", "Loading chunk 123 failed."), true);
  assert.equal(noise("Error", "ResizeObserver loop completed with undelivered notifications."), true);
  assert.equal(noise("Error", "Script error."), true);
  assert.equal(noise("AbortError", "The user aborted a request."), true);
  assert.equal(noise("Error", "Connection closed."), true);
  assert.equal(noise("Error", "Could not check your access to the portal: TypeError: fetch failed"), true);
  assert.equal(noise("TypeError", "x is undefined", "at y (chrome-extension://abc/content.js:1:1)"), true);
  assert.equal(noise("TypeError", "Cannot read properties of undefined (reading 'title')"), false);
  assert.equal(noise("Error", "Minified React error #418"), false);
});

test("reportingEnabled is on in production, or when a test asks for it", () => {
  assert.equal(reportingEnabled({ VERCEL_ENV: "production" }), true);
  assert.equal(reportingEnabled({ VERCEL_ENV: "preview" }), false);
  assert.equal(reportingEnabled({}), false);
  assert.equal(reportingEnabled({ ERROR_REPORTING: "on" }), true);
  assert.equal(reportingEnabled({ ERROR_REPORTING: "off", VERCEL_ENV: "production" }), true);
});

test("buildReport scrubs, bounds and fingerprints a report", () => {
  const report = buildReport({
    source: "browser",
    name: "TypeError",
    message: "No meal called 'Chicken curry' (reading 'title')",
    stack: "TypeError: x\n    at MealCard (https://portal.example.test/_next/static/chunks/0abc.js:1:2)",
    route: "/life/recipes/chicken-curry",
    context: "uncaught",
    release: "4c83117aa",
  });
  assert.equal(report.message, "No meal called '‹text›' (reading 'title')");
  assert.equal(report.route, "/life/recipes/[key]");
  assert.equal(report.stack, "at MealCard (/_next/static/chunks/0abc.js:1:2)");
  assert.equal(report.release, "4c83117aa");
  assert.match(report.fingerprint, /^[0-9a-f]{32}$/);
});

test("buildReport gives the same fingerprint to the same bug on any day, release or stack", () => {
  const base = {
    source: "server" as const,
    name: "TypeError",
    message: "Plan 2026-11-14 has no slot 'lunch'",
    stack: "",
    route: "/life",
    context: "render",
    release: "aaaaaaa",
  };
  const a = buildReport(base);
  const b = buildReport({
    ...base,
    message: "Plan 2026-11-15 has no slot 'lunch'",
    stack: "at x (a.js:1:1)",
    release: "bbbbbbb",
  });
  const c = buildReport({ ...base, route: "/week" });
  const d = buildReport({ ...base, context: "action" });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.notEqual(a.fingerprint, d.fingerprint);
});

test("buildReport refuses odd names and releases rather than storing them", () => {
  const report = buildReport({
    source: "server",
    name: "Not a <name>",
    message: "",
    stack: "",
    route: "/",
    context: "x".repeat(200),
    release: "not-a-commit",
  });
  assert.equal(report.name, "Error");
  assert.equal(report.message, "(no message)");
  assert.equal(report.release, null);
  assert.equal(report.context.length, 60);
});

test("readBrowserReport accepts what the browser sends and nothing else", () => {
  const ok = { name: "TypeError", message: "boom", stack: "", path: "/life", context: "uncaught", release: "" };
  assert.deepEqual(readBrowserReport(ok), ok);
  assert.equal(readBrowserReport(null), null);
  assert.equal(readBrowserReport([]), null);
  assert.equal(readBrowserReport({ ...ok, message: 42 }), null);
  assert.equal(readBrowserReport({ ...ok, context: "server" }), null);
  assert.equal(readBrowserReport({ ...ok, path: "life" }), null);
});

test("describeError reads Errors and anything else that gets thrown", () => {
  const e = new RangeError("too far");
  assert.deepEqual(
    { name: describeError(e).name, message: describeError(e).message },
    { name: "RangeError", message: "too far" },
  );
  assert.deepEqual(describeError("plain string"), { name: "Error", message: "plain string", stack: "" });
  assert.deepEqual(describeError({ message: "shaped like one", name: "Custom" }), {
    name: "Custom",
    message: "shaped like one",
    stack: "",
  });
  assert.deepEqual(describeError(undefined), { name: "Error", message: "undefined", stack: "" });
});
