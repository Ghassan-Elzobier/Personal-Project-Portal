#!/usr/bin/env node
// When main moves, finds open pull requests that now conflict with it, says so
// (with the conflicted files), and lists the owner's own claude/ branches for
// Claude to repair. Runs from .github/workflows/pr-conflicts.yml; decisions are
// in src/lib/ci/conflicts.ts. Needs a checkout with full history and gh signed in.
//
//   GITHUB_REPOSITORY=o/r node --experimental-strip-types --no-warnings scripts/pr-conflicts.mjs [--dry-run]
//   writes fix=[{"pr":12,"branch":"claude/x"}] to $GITHUB_OUTPUT
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { conflictMarker, conflictedFiles, shouldResolveConflict } from "../src/lib/ci/conflicts.ts";

const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("GITHUB_REPOSITORY is required.");

const run = (cmd, args, input) => spawnSync(cmd, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
const gh = (args, input) => {
  const r = run("gh", args, input);
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  return (r.stdout ?? "").trim();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const list = () =>
  JSON.parse(
    gh([
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,headRefName,headRefOid,isCrossRepository,mergeable,labels,comments",
    ]),
  );

// GitHub works out mergeability lazily after main moves, so wait for it.
let prs = list();
for (let i = 0; i < 12 && prs.some((p) => p.mergeable === "UNKNOWN"); i++) {
  await sleep(10_000);
  prs = list();
}

const fix = [];
for (const pr of prs) {
  if (pr.mergeable !== "CONFLICTING") continue;
  const fetched = run("git", ["fetch", "-q", "origin", `pull/${pr.number}/head`]);
  const merged = run("git", ["merge-tree", "--write-tree", "--name-only", "origin/main", "FETCH_HEAD"]);
  const files = fetched.status === 0 ? conflictedFiles(merged.stdout ?? "") : [];
  const marker = conflictMarker(pr.headRefOid);
  const bodies = pr.comments.map((c) => c.body);
  const attempts = bodies.filter((b) => b.includes("<!-- conflict-fix -->")).length;
  const resolve = shouldResolveConflict({
    branch: pr.headRefName,
    sameRepo: !pr.isCrossRepository,
    attempts,
    labels: pr.labels.map((l) => l.name),
    files,
  });
  console.log(
    `#${pr.number} ${pr.headRefName}: conflicts in ${files.join(", ") || "(unknown)"}${resolve ? " -> Claude" : ""}`,
  );
  if (resolve) fix.push({ pr: pr.number, branch: pr.headRefName });
  if (bodies.some((b) => b.includes(marker))) continue;
  const body =
    `${marker}\n${resolve ? "<!-- conflict-fix -->\n" : ""}**This pull request now conflicts with main**, after another one merged. ` +
    `Conflicting files: ${files.map((f) => `\`${f}\``).join(", ") || "(could not be listed)"}.\n\n` +
    (resolve
      ? `Asking Claude to merge main in and resolve it (attempt ${attempts + 1} of 2); it pushes to this branch.`
      : "It needs a look: merge main into the branch and resolve the files above.");
  if (dryRun) console.log(`[dry run] comment on #${pr.number}:\n${body}`);
  else gh(["pr", "comment", String(pr.number), "--repo", repo, "--body-file", "-"], body);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `fix=${JSON.stringify(fix)}\n`);
console.log(`${prs.filter((p) => p.mergeable === "CONFLICTING").length} conflicting, ${fix.length} handed to Claude.`);
