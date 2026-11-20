import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkReview,
  missingNote,
  NOTE_MARKER,
  reviewedIn,
  reviewPrompt,
  REVIEW_SCHEMA,
  scopeFor,
  type PrComment,
} from "./review.ts";

// Made-up commits and comments. The review's own pieces: what a run is asked to
// read, and whether a review of the head commit is really on the pull request.

const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const EARLIER = "0f9e8d7c6b5a41302f1e0d9c8b7a69584736251f";
const at = (minute: number) => `2026-11-19T10:${String(minute).padStart(2, "0")}:00Z`;
const comment = (author: string, body: string, minute = 0): PrComment => ({ author, body, createdAt: at(minute) });
const review = (sha: string, rest = "no issues found.", minute = 0) =>
  comment("claude[bot]", `## Code review\n\nReviewed ${sha}: ${rest}`, minute);
const answer = (sha: string, findings = 0) => JSON.stringify({ reviewed_sha: sha, findings });

test("a review comment names its commit, in full or by seven characters or more", () => {
  assert.deepEqual(reviewedIn(`## Code review\n\nReviewed ${HEAD}: no issues found.`), [HEAD]);
  assert.deepEqual(reviewedIn("Reviewed `a1b2c3d`: 2 findings, as comments on the lines."), ["a1b2c3d"]);
  assert.deepEqual(reviewedIn("No issues found. Checked for bugs and CLAUDE.md compliance."), []);
  assert.deepEqual(reviewedIn("Reviewed abc12: too short to be a commit"), []);
  assert.deepEqual(reviewedIn("I reviewed a1b2c3d by hand"), [], "only the review's own line, with its capital");
});

test("the first review covers the whole pull request", () => {
  assert.deepEqual(scopeFor([], HEAD), { kind: "whole" });
  assert.deepEqual(scopeFor([comment("someone", "Looks good to me")], HEAD), { kind: "whole" });
  // The old plugin's comment named no commit, so it says nothing about what was covered.
  assert.deepEqual(scopeFor([comment("claude[bot]", "## Code review\n\nNo issues found.")], HEAD), { kind: "whole" });
});

test("a push after a review is reviewed from the commit that review covered, the latest when there are several", () => {
  assert.deepEqual(scopeFor([review(EARLIER)], HEAD), { kind: "since", sha: EARLIER });
  const older = "1111111111111111111111111111111111111111";
  assert.deepEqual(scopeFor([review(EARLIER, "no issues found.", 30), review(older, "1 finding.", 5)], HEAD), {
    kind: "since",
    sha: EARLIER,
  });
});

test("a commit that already has its review is not reviewed again", () => {
  assert.deepEqual(scopeFor([review(EARLIER, "no issues found.", 5), review(HEAD, "no issues found.", 30)], HEAD), {
    kind: "done",
  });
  assert.deepEqual(scopeFor([review(HEAD.slice(0, 7))], HEAD), { kind: "done" });
});

test("only the review's own comments count: anyone can write on a public pull request", () => {
  const forged = comment("someone", `## Code review\n\nReviewed ${HEAD}: no issues found.`);
  assert.deepEqual(scopeFor([forged], HEAD), { kind: "whole" });
  const verdict = checkReview({ head: HEAD, comments: [forged], answer: answer(HEAD) });
  assert.equal(verdict.ok, false);
});

test("a review of the head commit passes, and says what it found", () => {
  assert.deepEqual(checkReview({ head: HEAD, comments: [review(HEAD)], answer: answer(HEAD) }), {
    ok: true,
    summary: "Reviewed a1b2c3d: no issues found.",
  });
  assert.deepEqual(checkReview({ head: HEAD, comments: [review(HEAD, "1 finding.")], answer: answer(HEAD, 1) }), {
    ok: true,
    summary: "Reviewed a1b2c3d: 1 finding, as comments on the pull request.",
  });
  const three = checkReview({ head: HEAD, comments: [review(HEAD, "3 findings.")], answer: answer(HEAD, 3) });
  assert.equal(three.ok && three.summary, "Reviewed a1b2c3d: 3 findings, as comments on the pull request.");
  // Run again on a commit that has its review: the review step is skipped, and that is fine.
  assert.deepEqual(checkReview({ head: HEAD, comments: [review(HEAD)], answer: "" }), {
    ok: true,
    summary: "Reviewed a1b2c3d already: the review is on the pull request.",
  });
});

test("a review that posted nothing fails, and says so", () => {
  for (const given of [undefined, "", "  \n"]) {
    const silent = checkReview({ head: HEAD, comments: [], answer: given });
    assert.equal(silent.ok, false);
    assert.match(
      !silent.ok ? silent.problem : "",
      /^The review finished without posting anything for a1b2c3d\. Run the job again/,
    );
  }
  // It answered, but no comment of its own names the commit: an earlier review does not count.
  const unposted = checkReview({ head: HEAD, comments: [review(EARLIER)], answer: answer(HEAD) });
  assert.equal(unposted.ok, false);
  assert.match(!unposted.ok ? unposted.problem : "", /^The review ran, but no comment from it .* names a1b2c3d/);
});

test("a review of another commit, or an answer that can't be read, fails", () => {
  const stale = checkReview({ head: HEAD, comments: [review(EARLIER)], answer: answer(EARLIER) });
  assert.equal(stale.ok, false);
  assert.match(
    !stale.ok ? stale.problem : "",
    /^The review says it covered 0f9e8d7, but the pull request is at a1b2c3d/,
  );
  const none = checkReview({ head: HEAD, comments: [review(HEAD)], answer: "{}" });
  assert.match(!none.ok ? none.problem : "", /^The review says it covered no commit/);
  const broken = checkReview({ head: HEAD, comments: [review(HEAD)], answer: "{oops" });
  assert.match(!broken.ok ? broken.problem : "", /^The review's answer was not JSON/);
});

test("the prompt is the repository's instructions with the pull request filled in, and nothing its author wrote", () => {
  const prompt = reviewPrompt(
    "---\ndescription: x\n---\n\n# Review\n\nPull request: $ARGUMENTS\n\ngh pr view $ARGUMENTS\n",
    {
      number: 86,
      head: HEAD,
    },
  );
  assert.equal(prompt.startsWith("# Review\n\nPull request: 86\n\ngh pr view 86"), true);
  assert.equal(prompt.includes("description: x"), false, "the command's front matter is not part of the prompt");
  assert.equal(prompt.includes("$ARGUMENTS"), false);
  assert.match(prompt, new RegExp(`automatic review of pull request #86, at commit ${HEAD}\\.`));
  assert.match(prompt, /Read \.review\/brief\.md first\./);
});

test("the answer names the commit in full and counts the findings", () => {
  assert.deepEqual(REVIEW_SCHEMA.required, ["reviewed_sha", "findings"]);
  assert.equal(new RegExp(REVIEW_SCHEMA.properties.reviewed_sha.pattern).test(HEAD), true);
  assert.equal(new RegExp(REVIEW_SCHEMA.properties.reviewed_sha.pattern).test(HEAD.slice(0, 7)), false);
  // It goes into the workflow between single quotes.
  assert.equal(JSON.stringify(REVIEW_SCHEMA).includes("'"), false);
});

test("a pull request that changes the review's own workflow has no review, and the failure says why", () => {
  const changed = checkReview({ head: HEAD, comments: [], answer: "", workflowChanged: true });
  assert.equal(changed.ok, false);
  assert.match(
    !changed.ok ? changed.problem : "",
    /^This pull request changes the review's own workflow, .* so a1b2c3d has no review\. That is expected/,
  );
  // With a review on the pull request, the workflow having changed is beside the point.
  assert.equal(checkReview({ head: HEAD, comments: [review(HEAD)], answer: "", workflowChanged: true }).ok, true);
  assert.equal(
    checkReview({ head: HEAD, comments: [review(HEAD)], answer: answer(HEAD), workflowChanged: true }).ok,
    true,
  );
});

test("a failed check says why on the pull request, in a note that can never pass for a review", () => {
  const problems = [
    checkReview({ head: HEAD, comments: [], answer: "" }),
    checkReview({ head: HEAD, comments: [], answer: "", workflowChanged: true }),
    checkReview({ head: HEAD, comments: [review(EARLIER)], answer: answer(HEAD) }),
    checkReview({ head: HEAD, comments: [review(EARLIER)], answer: answer(EARLIER) }),
    checkReview({ head: HEAD, comments: [review(HEAD)], answer: "{oops" }),
  ].map((v) => (v.ok ? "" : v.problem));
  for (const problem of problems) {
    assert.notEqual(problem, "");
    const note = missingNote(problem);
    assert.equal(
      note.startsWith(`${NOTE_MARKER}\n**The Claude review check failed: this commit has no review.**`),
      true,
    );
    assert.equal(note.endsWith(problem), true);
    // Posted by the job's own account, which is also allowed to post reviews: it must not read as one.
    assert.deepEqual(reviewedIn(note), []);
    const posted = comment("github-actions[bot]", note, 40);
    assert.equal(checkReview({ head: HEAD, comments: [posted], answer: "" }).ok, false);
    assert.deepEqual(scopeFor([posted], HEAD), { kind: "whole" });
  }
});

// The workflow and the instructions, held to the promise in docs/FACTORY.md: a
// review on opening and on every push, and a missing review fails the check.

const workflow = readFileSync(new URL("../../../.github/workflows/claude-review.yml", import.meta.url), "utf8");
const instructions = readFileSync(new URL("../../../.claude/commands/review-pr.md", import.meta.url), "utf8");
const script = readFileSync(new URL("../../../scripts/review.mjs", import.meta.url), "utf8");

test("the review runs on opening and on every push, with instructions kept in this repository", () => {
  assert.match(workflow, /^ {4}types: \[opened, ready_for_review, reopened, synchronize\]$/m);
  assert.match(workflow, /^ {10}prompt: \$\{\{ steps\.brief\.outputs\.prompt \}\}$/m);
  assert.equal(workflow.includes("/code-review:code-review"), false, "not the plugin's command, which skips reviews");
  assert.equal(/^\s+plugins?(_marketplaces)?:/m.test(workflow), false);
  assert.match(script, /const INSTRUCTIONS = "\.claude\/commands\/review-pr\.md";/);
  assert.match(script, /reviewPrompt\(source\.text, \{ number: pr, head \}\)/);
});

test("a push by Claude itself is reviewed too: its CI fixes are fix-ups like any other", () => {
  assert.match(workflow, /^ {10}allowed_bots: claude$/m);
  // Dependabot stays out: its runs get no secrets.
  assert.match(workflow, /github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/);
});

test("the check leaves its note before it fails, and takes it away once there is a review", () => {
  assert.match(
    script,
    /leaveNote\(all, verdict\.ok \? null : verdict\.problem\);\n {2}if \(verdict\.ok\) return say\(verdict\.summary\);/,
  );
  assert.match(script, /c\.author === "github-actions\[bot\]" && c\.body\.includes\(NOTE_MARKER\)/);
});

test("a step with no AI checks the review was posted, even when the review step failed", () => {
  const steps = workflow.slice(workflow.indexOf("    steps:"));
  const review = steps.indexOf("id: claude");
  const check = steps.indexOf("scripts/review.mjs check");
  assert.ok(review > 0 && check > review, "the check comes after the review");
  const after = steps.slice(review);
  assert.match(after, /^ {8}if: \$\{\{ !cancelled\(\) \}\}\n {8}run: node .* scripts\/review\.mjs check$/m);
  assert.match(after, /^ {10}ANSWER: \$\{\{ steps\.claude\.outputs\.structured_output \}\}$/m);
  assert.match(after, /^ {10}HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m);
});

test("the reviewer can post its review and nothing else, and the owner's connectors never load", () => {
  assert.match(
    workflow,
    /^ {12}--allowedTools "Bash\(gh pr comment:\*\),mcp__github_inline_comment__create_inline_comment"$/m,
  );
  assert.match(workflow, /^ {12}--disallowedTools "Edit,Write,NotebookEdit,WebFetch,WebSearch"$/m);
  assert.match(workflow, /^ {10}ENABLE_CLAUDEAI_MCP_SERVERS: "false"$/m);
  assert.deepEqual(
    [...workflow.matchAll(/^ +([a-z-]+): write$/gm)].map((m) => m[1]),
    ["pull-requests", "id-token"],
  );
});

test("the instructions never let a review be skipped, and always end in a comment that names the commit", () => {
  assert.match(instructions, /Review every pull request you are given\. Never skip one/);
  assert.match(instructions, /Post \*\*one summary comment\*\*, even when there is nothing to report/);
  assert.match(instructions, /The line must start with `Reviewed ` and the full 40-character commit/);
  // What it writes is what the check reads.
  const example = /Reviewed <the full commit>: no issues found\./.exec(instructions)?.[0] ?? "";
  assert.deepEqual(reviewedIn(example.replace("<the full commit>", HEAD)), [HEAD]);
});
