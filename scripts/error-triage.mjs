#!/usr/bin/env node
// The error triage: turns the production errors the portal recorded
// (portal.error_groups) into GitHub issues, keeps their counts current, reopens
// a fixed bug that came back, and says which issues to hand to Claude for a
// fix. .github/workflows/error-triage.yml runs it every hour; the decisions
// themselves are in src/lib/errors/issue.ts, with tests beside them.
//
//   node --experimental-strip-types --no-warnings scripts/error-triage.mjs [--local] [--dry-run]
//
// --local    read the local Supabase stack (SUPABASE_WORKDIR picks a scratch one)
//            instead of the linked production project
// --dry-run  print what it would do; change nothing on GitHub or in the database
//
// Needs gh signed in (GH_TOKEN in CI) and, without --local, `supabase link`.
// Writes the issues to fix as JSON to $GITHUB_OUTPUT (`fix=[12]`) when set.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  autofixLimit,
  decide,
  fingerprintIn,
  issueBody,
  issueTitle,
  reopenComment,
  shouldAutofix,
  NO_AUTOFIX,
} from "../src/lib/errors/issue.ts";

const flags = new Set(process.argv.slice(2));
const local = flags.has("--local");
const dryRun = flags.has("--dry-run");

const FINGERPRINT = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const LABELS = [
  ["bug", "d73a4a", "Works differently from how it should"],
  ["error-report", "b60205", "Filed automatically from an error in production"],
  [NO_AUTOFIX, "cfd3d7", "The error triage does not hand this issue to Claude"],
];

function gh(args, input) {
  const result = spawnSync("gh", args, { encoding: "utf8", input });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

function ghOrFail(args, input) {
  const result = gh(args, input);
  if (!result.ok) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${result.err}`);
  return result.out;
}

function git(...args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

/** Runs SQL on the production database (or the local stack) and returns its rows. */
function sql(query, { write = false } = {}) {
  const target = local
    ? process.env.SUPABASE_WORKDIR
      ? ["--workdir", process.env.SUPABASE_WORKDIR]
      : []
    : ["--remote", ...(write ? ["--yes"] : [])];
  const out = execFileSync(
    "npx",
    ["supabase", "db", "query", ...target, ...(write ? [] : ["--read-only"]), "--output-format", "json", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out).rows ?? [];
}

const repo =
  process.env.GITHUB_REPOSITORY ?? ghOrFail(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);

/** The issue's state and labels, or null when it no longer exists. Any other failure stops the run. */
function viewIssue(number) {
  const result = gh(["issue", "view", String(number), "--repo", repo, "--json", "state,stateReason,labels,body"]);
  if (!result.ok) {
    if (/could not resolve to an issue|not found/i.test(result.err)) return null;
    throw new Error(`gh issue view ${number} failed: ${result.err}`);
  }
  const issue = JSON.parse(result.out);
  return { ...issue, labels: issue.labels.map((label) => label.name) };
}

/**
 * Whether the code that last hit the error contains the fix: the commit that
 * closed the issue when there is one, or else anything committed after it was
 * closed. Null when that cannot be told.
 */
function releaseHasFix(number, release) {
  if (!release || !SHA.test(release) || git("cat-file", "-e", `${release}^{commit}`).status !== 0) return null;
  const events = JSON.parse(ghOrFail(["api", `repos/${repo}/issues/${number}/events?per_page=100`]));
  const closed = events.filter((event) => event.event === "closed").at(-1);
  if (!closed) return null;
  if (closed.commit_id && git("cat-file", "-e", `${closed.commit_id}^{commit}`).status === 0) {
    return git("merge-base", "--is-ancestor", closed.commit_id, release).status === 0;
  }
  const committed = Date.parse(git("show", "-s", "--format=%cI", release).stdout.trim());
  return committed > Date.parse(closed.created_at);
}

function record(fingerprint, status, issue, autofix) {
  if (dryRun) return;
  const number = Number.isInteger(issue) && issue > 0 ? issue : "null";
  sql(`select portal.record_triage('${fingerprint}', '${status}', ${number}, ${autofix})`, { write: true });
}

const perDay = autofixLimit(process.env.ERROR_AUTOFIX_PER_DAY);
let usedToday = sql("select count(*)::int as n from portal.error_groups where autofix_at > now() - interval '1 day'")[0]
  .n;
const groups = sql("select * from portal.errors_to_triage()");
const fix = [];
let labelsReady = false;

for (const group of groups) {
  if (!FINGERPRINT.test(group.fingerprint)) continue;
  const issue = group.issue_number ? viewIssue(group.issue_number) : null;
  const closedAsDone = issue?.state === "CLOSED" && issue.stateReason !== "NOT_PLANNED";
  const action = decide(group, issue, closedAsDone ? releaseHasFix(group.issue_number, group.release) : null);
  let number = group.issue_number;

  if (!dryRun) {
    if (action.kind === "file") {
      if (!labelsReady) {
        for (const [name, color, description] of LABELS) {
          gh(["label", "create", name, "--repo", repo, "--color", color, "--description", description]);
        }
        labelsReady = true;
      }
      const url = ghOrFail(
        ["issue", "create", "--repo", repo, "--title", issueTitle(group), "--body-file", "-"].concat([
          "--label",
          "bug",
          "--label",
          "error-report",
        ]),
        issueBody(group, repo),
      );
      number = Number(/\/issues\/(\d+)/.exec(url)?.[1]);
    } else if (action.kind === "update" && fingerprintIn(issue.body) === group.fingerprint) {
      ghOrFail(["issue", "edit", String(number), "--repo", repo, "--body-file", "-"], issueBody(group, repo));
    } else if (action.kind === "reopen") {
      ghOrFail(["issue", "reopen", String(number), "--repo", repo, "--comment", reopenComment(group, repo)]);
    }
  }

  const autofix = shouldAutofix(action, issue?.labels ?? [], usedToday, perDay);
  if (autofix) {
    usedToday += 1;
    if (number) fix.push(number);
  }
  record(group.fingerprint, action.kind === "ignore" ? "ignored" : "filed", number, autofix);
  console.log(
    `${dryRun ? "[dry run] " : ""}${action.kind} ${number ? `#${number}` : "(new issue)"}: ` +
      `${issueTitle(group)}${autofix ? " -> Claude" : ""}`,
  );
  if (dryRun && action.kind === "file") console.log(issueBody(group, repo));
}

console.log(`${groups.length} error groups triaged; ${fix.length} handed to Claude (${usedToday} of ${perDay} today).`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `fix=${JSON.stringify(fix)}\n`);
