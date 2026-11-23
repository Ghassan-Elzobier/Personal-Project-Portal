import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtFor, builtIssues, cherryCounts, closingComment, spentBranches } from "./after-merge.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("a branch built on GitHub names its issue", () => {
  assert.equal(builtFor("claude/issue-122-20261122-1538"), 122);
  assert.equal(builtFor("claude/rnd-127-role-deadlines"), 127);
  assert.equal(builtFor("claude/fix-12-quoted-values"), 12);
  assert.equal(builtFor("claude/issue-7"), 7);
  // A session's branch names a change, not an issue.
  assert.equal(builtFor("claude/next-week-plans-itself"), null);
  assert.equal(builtFor("claude/issue-tracker"), null);
  assert.equal(builtFor("claude/issues-to-prs"), null);
  assert.equal(builtFor("feature/issue-3-x"), null);
  assert.equal(builtFor("dependabot/npm_and_yarn/issue-4"), null);
});

test("an open issue closes once a branch built for it merges, and only then", () => {
  const merged = [
    { number: 72, branch: "claude/issue-71-20261119-1740" },
    { number: 132, branch: "claude/issue-122-20261122-1538" },
    { number: 140, branch: "claude/issue-122-again" },
    { number: 121, branch: "claude/next-week-plans-itself" },
  ];
  assert.deepEqual(builtIssues([122, 126, 127], merged), [{ issue: 122, pr: 132 }]);
  // Already closed: nothing to do.
  assert.deepEqual(builtIssues([126], merged), []);
  assert.match(closingComment(132), /^Built in #132, which has merged/);
  assert.equal(closingComment(132).includes("@"), false, "no mention that could start a run");
});

test("only agent branches main already holds go, and never one an open pull request uses", () => {
  const { remove, keep } = spentBranches([
    { name: "claude/your-day", ahead: 0, equivalent: 0, open: false },
    // Rebased and merged under new commits: every change is in main.
    { name: "claude/lab-type-scale", ahead: 2, equivalent: 2, open: false },
    // Pushed to after its pull request merged: one change main lacks.
    { name: "claude/money-plan", ahead: 1, equivalent: 0, open: false },
    { name: "claude/issue-123-20261122-1538", ahead: 2, equivalent: 0, open: true },
    { name: "claude/just-started", ahead: 0, equivalent: 0, open: true },
    { name: "main", ahead: 0, equivalent: 0, open: false },
    { name: "owner-experiment", ahead: 0, equivalent: 0, open: false },
  ]);
  assert.deepEqual(remove, ["claude/lab-type-scale", "claude/your-day"]);
  assert.deepEqual(keep, [
    { name: "claude/issue-123-20261122-1538", why: "an open pull request uses it" },
    { name: "claude/just-started", why: "an open pull request uses it" },
    { name: "claude/money-plan", why: "1 commit main does not have" },
  ]);
});

test("git cherry's marks count the commits main has as an equal patch", () => {
  const out = [
    "- 1801a50 Give the Lab figures a type scale",
    "+ d036aae Keep a goal's link",
    "- 1aa3e75 Show them",
    "",
  ];
  assert.deepEqual(cherryCounts(out.join("\n")), { ahead: 3, equivalent: 2 });
  assert.deepEqual(cherryCounts(""), { ahead: 0, equivalent: 0 });
});

test("the after-merge job runs with no AI, only for this repository's merged pull requests, or by hand", () => {
  const workflow = read(".github/workflows/after-merge.yml");
  assert.match(workflow, /^ {2}pull_request:\n {4}types: \[closed\]\n {4}branches: \[main\]$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.match(workflow, /github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.equal(workflow.includes("anthropics/claude-code-action"), false);
  assert.equal(workflow.includes("pull_request_target"), false);
  // The branch name is the pull request's own text: it reaches the script as data, never through the shell.
  assert.equal(/run: .*\$\{\{/.test(workflow), false);
  assert.deepEqual([...workflow.matchAll(/^ +([a-z-]+): write$/gm)].map((m) => m[1]).sort(), ["contents", "issues"]);
});

test("@claude opens the pull request itself, saying which issue it closes", () => {
  const workflow = read(".github/workflows/claude.yml");
  const args = workflow.match(/claude_args: >-\n((?: {12}.*\n)+)/)?.[1] ?? "";
  assert.match(args, /--append-system-prompt '/);
  const asked = args.match(/--append-system-prompt '([^']+)'/)?.[1].replace(/\s+/g, " ") ?? "";
  assert.match(asked, /gh pr create/);
  assert.match(asked, /Closes #/);
  assert.match(asked, /instead of a Create PR link/);
  // Said in single quotes, so nothing in it reaches a shell, and without "@", which would start another run.
  assert.equal(asked.includes("@"), false);
});
