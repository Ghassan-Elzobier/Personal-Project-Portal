// R&D build's pull requests open under the owner's account, from a job Claude never
// touches, and every Claude job commits under the owner's name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BODY_MAX, TITLE_MAX, bodyOf, branchFor, titleOf } from "./open.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("only a branch named for this proposal is opened", () => {
  assert.equal(branchFor(140, "claude/rnd-140-early-pay\n"), "claude/rnd-140-early-pay");
  assert.equal(branchFor(140, "claude/rnd-139-early-pay"), null, "another proposal's branch");
  assert.equal(branchFor(140, "main"), null);
  assert.equal(branchFor(140, "claude/rnd-140-Early Pay"), null);
  assert.equal(branchFor(140, "claude/rnd-140-x; rm -rf /"), null);
  assert.equal(branchFor(140, `claude/rnd-140-${"a".repeat(70)}`), null, "too long");
});

test("the title is one line, cut to fit a list", () => {
  assert.equal(titleOf("\n  Money: early pay counts once  \nmore"), "Money: early pay counts once");
  assert.equal(titleOf(" \n "), null);
  const long = titleOf("x".repeat(500)) ?? "";
  assert.equal(long.length, TITLE_MAX);
  assert.ok(long.endsWith("…"));
});

test("the description ends by closing the proposal, with no AI attribution and no runaway length", () => {
  assert.equal(bodyOf("## What changes\n\nIt does.\n", 140), "## What changes\n\nIt does.\n\nCloses #140\n");
  assert.equal(bodyOf("It does.\n\nCloses #140\n\n", 140), "It does.\n\nCloses #140\n", "not twice");
  assert.equal(
    bodyOf(
      "It does.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nCo-Authored-By: Claude <x@y>\n",
      140,
    ),
    "It does.\n\nCloses #140\n",
  );
  assert.equal(bodyOf("", 140), "Closes #140\n");
  const long = bodyOf("y".repeat(BODY_MAX * 2), 140);
  assert.ok(long.length <= BODY_MAX && long.endsWith("Closes #140\n"));
});

test("Claude asks for the pull request; a job on a fresh runner opens it with the owner's token", () => {
  const workflow = read(".github/workflows/rnd-build.yml");
  const [beforeOpen, open = ""] = workflow.split(/^ {2}open:$/m);
  const build = beforeOpen.split(/^ {2}build:$/m)[1] ?? "";
  // The build can't open one, and never sees the owner's token.
  const tools = build.match(/--allowedTools "([^"]+)"/)?.[1].split(",") ?? [];
  assert.ok(!tools.some((t) => t.startsWith("Bash(gh pr create")), tools.join());
  assert.doesNotMatch(build, /OWNER_PR_TOKEN/);
  assert.match(build, /Don't open the pull request yourself/);
  assert.match(build, /`\.rnd-pr\/branch\.txt`/);
  assert.match(build, /name: pr-\$\{\{ matrix\.issue \}\}\n {10}path: \.rnd-pr\/\n {10}include-hidden-files: true/);
  assert.match(build, /^ {10}PR_REQUEST: \.rnd-pr\/body\.md$/m);
  assert.match(read(".gitignore"), /^\.rnd-pr\/$/m);
  // The open job: after the builds, main's own code, no Claude, the owner's token only there.
  assert.match(open, /^ {4}needs: \[pick, build\]$/m);
  assert.match(open, /^ {10}ref: main$/m);
  assert.match(open, /^ {10}persist-credentials: false$/m);
  assert.doesNotMatch(open, /claude-code-action/);
  assert.match(open, /^ {10}OWNER_TOKEN: \$\{\{ secrets\.OWNER_PR_TOKEN \}\}$/m);
  assert.match(open, /run: node --experimental-strip-types --no-warnings scripts\/rnd-open\.mjs$/m);
  assert.doesNotMatch(
    open,
    /^ +(contents|pull-requests|actions): write$/m,
    "its own token can't push or open anything",
  );
  assert.equal(workflow.match(/secrets\.OWNER_PR_TOKEN/g)?.length, 1, "the owner's token is read once");
});

test("every Claude job that commits does so under the owner's name", () => {
  for (const file of ["rnd-build", "claude", "ci-triage", "error-triage", "pr-conflicts"]) {
    const workflow = read(`.github/workflows/${file}.yml`);
    assert.match(workflow, /^ {10}bot_id: \$\{\{ github\.repository_owner_id \}\}$/m, file);
    assert.match(workflow, /^ {10}bot_name: \$\{\{ github\.repository_owner \}\}$/m, file);
  }
});
