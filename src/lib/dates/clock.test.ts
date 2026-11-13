import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { now } from "./clock.ts";

const saved = { fixed: process.env.PORTAL_FIXED_NOW, vercel: process.env.VERCEL };

afterEach(() => {
  for (const [key, value] of [
    ["PORTAL_FIXED_NOW", saved.fixed],
    ["VERCEL", saved.vercel],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("now() follows the real clock when nothing is pinned", () => {
  delete process.env.PORTAL_FIXED_NOW;
  const before = Date.now();
  const t = now().getTime();
  assert.ok(t >= before && t <= Date.now());
});

test("now() returns the pinned instant in a test run", () => {
  delete process.env.VERCEL;
  process.env.PORTAL_FIXED_NOW = "2026-11-16T09:30:00Z";
  assert.equal(now().toISOString(), "2026-11-16T09:30:00.000Z");
});

test("a pinned clock is ignored on Vercel, so the live site never freezes", () => {
  process.env.VERCEL = "1";
  process.env.PORTAL_FIXED_NOW = "2026-11-16T09:30:00Z";
  assert.notEqual(now().toISOString(), "2026-11-16T09:30:00.000Z");
});

test("a malformed pin falls back to the real clock", () => {
  delete process.env.VERCEL;
  process.env.PORTAL_FIXED_NOW = "not a date";
  assert.ok(Math.abs(now().getTime() - Date.now()) < 1000);
});
