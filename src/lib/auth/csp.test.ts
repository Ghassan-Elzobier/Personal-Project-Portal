import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, newNonce } from "./csp.ts";

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values] as const;
    }),
  );

test("scripts run only with this request's nonce, and what those scripts load", () => {
  const policy = directives(contentSecurityPolicy("abc123", false));
  assert.deepEqual(policy.get("script-src"), ["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
});

test("no script may run inline or from text, outside development", () => {
  const script = directives(contentSecurityPolicy("abc123", false)).get("script-src") ?? [];
  assert.equal(script.includes("'unsafe-inline'"), false);
  assert.equal(script.includes("'unsafe-eval'"), false);
});

test("development alone may evaluate text, which React's error overlay needs", () => {
  const script = directives(contentSecurityPolicy("abc123", true)).get("script-src") ?? [];
  assert.equal(script.includes("'unsafe-eval'"), true);
  assert.equal(script.includes("'unsafe-inline'"), false);
});

test("plugins, a changed base address and framing by another site are all refused", () => {
  const policy = directives(contentSecurityPolicy("abc123", false));
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'none'"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
});

test("the browser talks only to the portal, and pictures come only from it or from the page itself", () => {
  const policy = directives(contentSecurityPolicy("abc123", false));
  assert.deepEqual(policy.get("connect-src"), ["'self'"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:"]);
  // Inline styles stay for now: the pages set run-time sizes with style={}.
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  // The consent page hands the browser on to Claude after a form post, so forms are not held to the portal yet.
  assert.equal(policy.has("form-action"), false);
});

test("a nonce is new every time and safe to put in a header", () => {
  const seen = new Set(Array.from({ length: 50 }, () => newNonce()));
  assert.equal(seen.size, 50);
  for (const nonce of seen) assert.match(nonce, /^[A-Za-z0-9+/]{40,}={0,2}$/);
});
