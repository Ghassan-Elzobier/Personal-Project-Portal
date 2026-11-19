import { test } from "node:test";
import assert from "node:assert/strict";
import { FOCI } from "./foci.ts";
import { focusOf, issueBody, issueTitle, marker, quiet, updateComment, whereLink, type Context } from "./issue.ts";
import type { Proposal } from "./result.ts";

const REPO = "someone/portal";
const ctx: Context = {
  repo: REPO,
  sha: "abc1234",
  day: "2026-11-19",
  runUrl: "https://github.com/someone/portal/actions/runs/1",
  isFile: (path) => ["src/lib/life/gym/progress.ts", "src/app/lab/[view]/page.tsx"].includes(path),
};
const gym = FOCI.find((f) => f.id === "gym") ?? FOCI[0];
const proposal: Proposal = {
  title: "Suggest the next weight from the last session",
  serves: "gym",
  problem: "Ask @claude? No: the page leaves the next weight to memory.",
  evidence: [
    { where: "src/lib/life/gym/progress.ts:12-20", what: "Progress is computed but never shown." },
    { where: "/life/gym", what: "The page shot has no suggestion." },
  ],
  research: [
    { source: "Example Society, Progression, 2024", url: "https://example.org/a(b)", finding: "Small steps." },
    { source: "A framework issue", url: "https://github.com/vercel/next.js/issues/1", finding: "Known." },
  ],
  change: "Show it beside each exercise, as `@suggested` in code.",
  acceptance: ["The gym page shows a suggested weight."],
  considered: "A chart.",
  risks: "A wrong suggestion.",
  size: "small",
  impact: 4,
  confidence: 3,
};

test("mentions and other repositories' threads are kept from reaching anyone", () => {
  assert.equal(quiet("thanks @claude and @someone", REPO), "thanks ＠claude and ＠someone");
  assert.equal(quiet("write to owner@example.test", REPO), "write to owner@example.test");
  assert.equal(quiet("`@claude` stays code", REPO), "`@claude` stays code");
  assert.equal(
    quiet("see vercel/next.js#123 and someone/portal#4", REPO),
    "see `vercel/next.js#123` and someone/portal#4",
  );
  assert.equal(
    quiet("see https://github.com/vercel/next.js/issues/9 and https://github.com/someone/portal/issues/4", REPO),
    "see `https://github.com/vercel/next.js/issues/9` and https://github.com/someone/portal/issues/4",
  );
  assert.equal(
    quiet("[the bug](https://github.com/vercel/next.js/pull/7)", REPO),
    "the bug (`https://github.com/vercel/next.js/pull/7`)",
  );
});

test("evidence in the repository links to the lines at the commit read", () => {
  assert.equal(
    whereLink("src/lib/life/gym/progress.ts:12-20", ctx),
    "[`src/lib/life/gym/progress.ts:12-20`](https://github.com/someone/portal/blob/abc1234/src/lib/life/gym/progress.ts#L12-L20)",
  );
  assert.equal(
    whereLink("src/app/lab/[view]/page.tsx", ctx),
    "[`src/app/lab/[view]/page.tsx`](https://github.com/someone/portal/blob/abc1234/src/app/lab/%5Bview%5D/page.tsx)",
  );
  assert.equal(whereLink("/life/gym", ctx), "`/life/gym`");
  assert.equal(whereLink("#12", ctx), "#12");
  assert.equal(whereLink("src/missing.ts:3", ctx), "`src/missing.ts:3`");
  assert.equal(whereLink("../../etc/passwd", { ...ctx, isFile: () => true }), "`../../etc/passwd`");
});

test("the issue reads top-down: problem, evidence, research, change, done when", () => {
  const body = issueBody(gym, proposal, ctx);
  const order = [
    "## The problem",
    "## Evidence",
    "## What the research says",
    "## The change",
    "## Done when",
    "## Also considered",
    "## Risks",
  ];
  const at = order.map((h) => body.indexOf(h));
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  assert.ok(at.every((i) => i >= 0));
  assert.match(body, /^\*\*For:\*\* Gym routine · \*\*Size:\*\* small · \*\*Impact:\*\* 4\/5/);
  assert.match(body, /Ask ＠claude\?/);
  assert.match(body, /`@suggested`/);
  assert.match(body, /\[Example Society, Progression, 2024\]\(https:\/\/example\.org\/a%28b%29\)/);
  assert.match(body, /A framework issue \(`https:\/\/github\.com\/vercel\/next\.js\/issues\/1`\)/);
  assert.match(body, /- \[ \] The gym page shows a suggested weight\./);
  assert.equal(body.includes("@claude"), false, "no at-claude that could start a run");
  assert.equal(focusOf(body), "gym");
  assert.ok(body.endsWith(marker("gym")));
});

test("the title starts with the focus, and an update keeps to what is new", () => {
  assert.equal(issueTitle(gym, proposal), "Gym: Suggest the next weight from the last session");
  const comment = updateComment(gym, proposal, ctx);
  assert.match(comment, /^\*\*More on this from R&D's gym focus\*\* \(2026-11-19/);
  assert.match(comment, /## The change, as it stands now/);
  assert.equal(comment.includes(marker("gym")), false);
});
