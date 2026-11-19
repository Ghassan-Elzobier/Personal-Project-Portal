import { test } from "node:test";
import assert from "node:assert/strict";
import { RESULT_SCHEMA, checkResult, findSensitive, safeUrl, sensitiveIn, type Result } from "./result.ts";

// Made-up answers. Secret-shaped strings are built at run time, so no secret
// scanner mistakes this file for a leak.
const proposal = {
  title: "  Suggest   the next weight from the last session  ",
  serves: "gym",
  problem: "The gym page shows last week's sets but leaves the next weight to memory.",
  evidence: [{ where: "src/lib/life/gym/progress.ts:12", what: "Progress is computed but never shown." }],
  research: [
    { source: "Example Society, Progression, 2024", url: "https://example.org/progression", finding: "Small steps." },
  ],
  change: "Show the suggested weight beside each exercise.",
  acceptance: ["The gym page shows a suggested weight for every exercise with a past session."],
  considered: "A weekly plan; a chart. Both cost more taps.",
  risks: "A wrong suggestion; it stays a suggestion.",
  size: "small",
  impact: 4,
  confidence: 3,
};

test("the schema can sit inside single quotes in the workflow", () => {
  assert.equal(JSON.stringify(RESULT_SCHEMA).includes("'"), false);
  assert.deepEqual(RESULT_SCHEMA.required, ["outcome", "looked_at"]);
  assert.equal(RESULT_SCHEMA.properties.proposal.required.length, 12);
});

test("a proposal comes back tidied", () => {
  const checked = checkResult({ outcome: "proposal", looked_at: "The gym page and its progress code.", proposal });
  assert.equal(checked.ok, true);
  const result = checked.ok && checked.result;
  assert.equal(
    result && result.outcome === "proposal" && result.proposal.title,
    "Suggest the next weight from the last session",
  );
});

test("a private finding keeps the area and nothing else", () => {
  const checked = checkResult({ outcome: "private", area: "database access", looked_at: "details", proposal });
  assert.deepEqual(checked.ok && checked.result, { outcome: "private", area: "database access" });
  assert.equal(checkResult({ outcome: "private", looked_at: "details" }).ok, false);
});

test("each outcome needs its own parts", () => {
  assert.equal(checkResult({ outcome: "nothing", looked_at: "The money page." }).ok, true);
  assert.equal(checkResult({ outcome: "nothing" }).ok, false);
  assert.equal(checkResult({ outcome: "proposal", looked_at: "x" }).ok, false);
  assert.equal(checkResult({ outcome: "update", looked_at: "x", proposal }).ok, false);
  assert.equal(checkResult({ outcome: "update", looked_at: "x", issue: 12, proposal }).ok, true);
  assert.equal(checkResult({ outcome: "maybe", looked_at: "x" }).ok, false);
  assert.equal(checkResult("proposal").ok, false);
});

test("problems name the fields, never their text", () => {
  const checked = checkResult({
    outcome: "proposal",
    looked_at: "x",
    proposal: {
      ...proposal,
      serves: "my secret plan",
      evidence: [],
      research: [{ ...proposal.research[0], url: "http://a.b" }],
    },
  });
  assert.equal(checked.ok, false);
  const problems = checked.ok ? [] : checked.problems;
  assert.deepEqual(problems, [
    "serves is not one of: study, schedule, gym, food, money, whole portal, factory",
    "evidence needs at least 1",
    "research 1 url is not a plain https link",
  ]);
});

test("long text is cut to fit and reported", () => {
  const checked = checkResult({
    outcome: "proposal",
    looked_at: "x",
    proposal: { ...proposal, problem: "a".repeat(2000), acceptance: ["one", "two", "three", "four"] },
  });
  assert.equal(checked.ok, true);
  if (!checked.ok || checked.result.outcome !== "proposal") return;
  assert.equal(checked.result.proposal.problem.length, 1500);
  assert.ok(checked.result.proposal.problem.endsWith("…"));
  assert.equal(checked.result.proposal.acceptance.length, 3);
  assert.deepEqual(checked.trimmed, ["problem", "acceptance"]);
});

test("links are plain https to a public host", () => {
  assert.equal(safeUrl("https://web.dev/articles/inp"), true);
  assert.equal(safeUrl("http://web.dev"), false);
  assert.equal(safeUrl("https://user:pass@example.org/"), false);
  assert.equal(safeUrl("https://localhost/x"), false);
  assert.equal(safeUrl("javascript:alert(1)"), false);
});

test("secrets and personal details are spotted by kind", () => {
  const cases: [string, string][] = [
    ["sk-" + "ant-" + "a1".repeat(12), "an Anthropic key or token"],
    ["gh" + "p_" + "A1b2".repeat(9), "a GitHub token"],
    ["eyJ" + "hbGciOiJI." + "eyJ" + "zdWIiOiIx." + "c2lnbmF0dXJl", "a JSON web token"],
    ["-----BEGIN " + "PRIVATE KEY-----", "a private key"],
    ["write to someone@gmail.com", "an email address"],
    ["call 07700 900123", "a phone number"],
    ["sort code 12-34-56", "bank details"],
    ["card 4111 1111 1111 1111", "a card number"],
  ];
  for (const [text, kind] of cases) assert.deepEqual(findSensitive(text), [kind], text);
});

test("ordinary technical writing passes", () => {
  for (const text of [
    "owner@example.test signs in on the seeded stack",
    "Upgrade next@16.4.6 and react@19.2.0; clone git@github.com:vercel/next.js",
    "Released 2026-11-19, issue #12, 1500 ms, version 1.0.276",
    "The INP threshold is 200 ms at the 75th percentile.",
    "@supabase/ssr refreshes the session",
  ])
    assert.deepEqual(findSensitive(text), [], text);
  assert.deepEqual(findSensitive("https://x.example.org/status/4111111111111111", { link: true }), []);
});

test("every part of a result is checked", () => {
  const checked = (changes: object): Result => {
    const c = checkResult({ outcome: "proposal", looked_at: "x", proposal: { ...proposal, ...changes } });
    assert.ok(c.ok);
    return c.result;
  };
  assert.deepEqual(sensitiveIn(checked({})), []);
  assert.deepEqual(sensitiveIn(checked({ risks: "mail a@gmail.com" })), ["an email address"]);
  const secret = "sk-" + "ant-" + "x".repeat(20);
  const research = [{ source: "s", url: `https://a.example.org/?k=${secret}`, finding: "f" }];
  assert.deepEqual(sensitiveIn(checked({ research })), ["an Anthropic key or token"]);
  assert.deepEqual(sensitiveIn({ outcome: "nothing", lookedAt: "The money page." }), []);
});
