#!/usr/bin/env node
// After a pull request merges (.github/workflows/after-merge.yml): closes the
// open issues whose built branch has merged, and deletes agent branches main
// already holds. Decisions are in src/lib/ci/after-merge.ts. No AI. Needs a
// checkout with full history and gh signed in (GH_TOKEN in CI).
//
//   GITHUB_REPOSITORY=o/r node --experimental-strip-types --no-warnings scripts/after-merge.mjs [--dry-run]
//
// Branch names and issue text are data: they reach git and gh as arguments, never a shell.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { builtIssues, cherryCounts, closingComment, spentBranches } from "../src/lib/ci/after-merge.ts";

const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is required.");

const run = (cmd, args, input) => spawnSync(cmd, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
const gh = (args, input) => {
  const r = run("gh", args, input);
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  return (r.stdout ?? "").trim();
};
/** Every page of a REST list. */
const all = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path]) || "[]").flat();
const say = (line) => {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
};

// Issues: an open one whose built branch has merged closes, saying which pull request built it.
// A merge closes the one issue its own branch names. By hand, every open issue is looked at,
// bar the error triage's own (`error-report`): it reopens a bug that came back after its fix
// merged, and a sweep must not close it again.
const open = all(`repos/${repo}/issues?state=open&per_page=100`)
  .filter((i) => !i.pull_request && (process.env.PR || !i.labels.some((l) => l.name === "error-report")))
  .map((i) => i.number);
const merged = process.env.PR
  ? [{ number: Number(process.env.PR), branch: process.env.BRANCH ?? "" }]
  : all(`repos/${repo}/pulls?state=closed&per_page=100`)
      .filter((p) => p.merged_at && p.base?.ref === "main" && p.head?.repo?.full_name === repo)
      .map((p) => ({ number: p.number, branch: p.head.ref }));
const closing = builtIssues(open, merged);
for (const { issue, pr } of closing) {
  if (dryRun) {
    console.log(`[dry run] would close #${issue}: built in #${pr}`);
    continue;
  }
  gh(["issue", "comment", String(issue), "--repo", repo, "--body-file", "-"], closingComment(pr));
  gh(["api", "-X", "PATCH", `repos/${repo}/issues/${issue}`, "-f", "state=closed", "-f", "state_reason=completed"]);
  say(`Closed #${issue}: built in #${pr}, which has merged.`);
}

// Branches: agent branches main holds every change of, with no open pull request on them.
const fetched = run("git", ["fetch", "-q", "--prune", "origin", "+refs/heads/claude/*:refs/remotes/origin/claude/*"]);
if (fetched.status !== 0) throw new Error(`git fetch failed: ${(fetched.stderr ?? "").trim()}`);
const heads = new Set(all(`repos/${repo}/pulls?state=open&per_page=100`).map((p) => p.head.ref));
const names = (run("git", ["for-each-ref", "--format=%(refname:lstrip=3)", "refs/remotes/origin/claude/"]).stdout ?? "")
  .split("\n")
  .filter(Boolean);
const states = names.map((name) => {
  const cherry = run("git", ["cherry", "origin/main", `refs/remotes/origin/${name}`]);
  // Without a common history git cherry fails: count the branch as all new, so it stays.
  const counts = cherry.status === 0 ? cherryCounts(cherry.stdout ?? "") : { ahead: 1, equivalent: 0 };
  return { name, ...counts, open: heads.has(name) };
});
const { remove, keep } = spentBranches(states);
for (const name of remove) {
  if (dryRun) {
    console.log(`[dry run] would delete ${name}`);
    continue;
  }
  gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${name.split("/").map(encodeURIComponent).join("/")}`]);
  say(`Deleted ${name}: main has every change on it.`);
}
for (const k of keep) console.log(`Kept ${k.name}: ${k.why}.`);
say(
  `${dryRun ? "[dry run] " : ""}${closing.length} ${closing.length === 1 ? "issue" : "issues"} closed, ` +
    `${remove.length} ${remove.length === 1 ? "branch" : "branches"} deleted, ${keep.length} kept.`,
);
