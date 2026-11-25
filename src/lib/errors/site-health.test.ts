import { test } from "node:test";
import assert from "node:assert/strict";
import { SITE_MARKER, decideSite, judgeSite, siteIssueBody, type Probe } from "./site-health.ts";

// Made-up answers, shaped like the live site's.
const redirect: Probe = { status: 307, location: "/login", body: "" };
const loginPage =
  '<html><body><h1 class="text-3xl font-bold">Sign in</h1><form>' +
  '<input name="email" type="email" required placeholder="you@example.com"/></form></body></html>';
const login: Probe = { status: 200, location: null, body: loginPage };
const noAnswer: Probe = { status: null, location: null, body: null };

test("a redirect from / to /login and a sign-in form on /login is healthy", () => {
  assert.deepEqual(judgeSite({ root: redirect, login }), { healthy: true, failed: [] });
  const absolute = { ...redirect, status: 302, location: "https://portal.example.test/login" };
  assert.equal(judgeSite({ root: absolute, login }).healthy, true);
});

test("each way the site can break is a named failed check", () => {
  const cases: [string, Parameters<typeof judgeSite>[0], object][] = [
    ["5xx on /login", { root: redirect, login: { ...login, status: 503 } }, { check: "login", reason: "status" }],
    ["5xx on /", { root: { ...redirect, status: 500, location: null }, login }, { check: "proxy", reason: "status" }],
    ["/login times out", { root: redirect, login: noAnswer }, { check: "login", reason: "no-answer" }],
    ["/ times out", { root: noAnswer, login }, { check: "proxy", reason: "no-answer" }],
    [
      "/login says not configured",
      { root: redirect, login: { ...login, body: "<h1>Sign in</h1><p>Supabase is not configured yet.</p>" } },
      { check: "login", reason: "not-configured" },
    ],
    [
      "/ answers 200 without redirecting",
      { root: { status: 200, location: null, body: "<html></html>" }, login },
      { check: "proxy", reason: "no-redirect" },
    ],
    [
      "/ redirects somewhere else",
      { root: { ...redirect, location: "/vercel-error" }, login },
      { check: "proxy", reason: "no-redirect" },
    ],
    [
      "/login has no form",
      { root: redirect, login: { ...login, body: "<h1>Something went wrong</h1>" } },
      { check: "login", reason: "no-form" },
    ],
  ];
  for (const [name, probes, failure] of cases) {
    const h = judgeSite(probes);
    assert.equal(h.healthy, false, name);
    assert.equal(h.failed.length, 1, name);
    assert.partialDeepStrictEqual(h.failed[0], failure, name);
  }
  assert.equal(judgeSite({ root: noAnswer, login: noAnswer }).failed.length, 2);
});

test("the triage files one issue while the site fails and closes it once it loads", () => {
  const down = judgeSite({ root: redirect, login: noAnswer });
  const up = judgeSite({ root: redirect, login });
  assert.equal(decideSite(down, false), "file");
  assert.equal(decideSite(down, true), "update", "an open issue is kept current, never filed twice");
  assert.equal(decideSite(up, true), "close");
  assert.equal(decideSite(up, false), "none");
});

test("the issue says only check names, reasons and status codes", () => {
  const leaky = judgeSite({
    root: { status: 302, location: "https://private.example.test/secret?token=abc123", body: "Set-Cookie: sb=xyz" },
    login: { status: 200, location: null, body: "<p>Hello owner@example.test, Supabase is not configured</p>" },
  });
  const body = siteIssueBody(leaky, 3);
  assert.ok(body.startsWith(SITE_MARKER));
  assert.doesNotMatch(body, /example\.test|secret|token|abc123|cookie|xyz|Hello|https?:/i);
  assert.match(body, /\| 302 \|/);
  assert.match(body, /not configured \| 200 \|/);
  assert.match(body, /3 tries/);
  assert.match(
    siteIssueBody(judgeSite({ root: noAnswer, login }), 3),
    /no answer \(refused, or none within 15 seconds\) \| none \|/,
  );
});
