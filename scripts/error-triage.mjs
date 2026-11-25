#!/usr/bin/env node
// The error triage: turns the production errors the portal recorded
// (portal.error_groups) into GitHub issues, keeps their counts current, reopens
// a fixed bug that came back, and says which issues to hand to Claude for a
// fix. .github/workflows/error-triage.yml runs it every 30 minutes; the decisions
// themselves are in src/lib/errors/issue.ts, with tests beside them. It also
// watches the scheduled bank sync, which fails without recording an error when
// the cron never reaches it (src/lib/errors/sync-health.ts), and loads the live
// site signed out when PORTAL_URL is set (src/lib/errors/site-health.ts).
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
  queryRows,
  NO_AUTOFIX,
} from "../src/lib/errors/issue.ts";
import {
  SYNC_HEALTH_QUERY,
  SYNC_MARKER,
  SYNC_TITLE,
  decideSync,
  syncClosedComment,
  syncHealthFrom,
  syncIssueBody,
} from "../src/lib/errors/sync-health.ts";
import {
  SITE_CLOSED_COMMENT,
  SITE_MARKER,
  SITE_TITLE,
  decideSite,
  judgeSite,
  siteIssueBody,
} from "../src/lib/errors/site-health.ts";

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

/**
 * Runs SQL on the production database (or the local stack) and returns its rows.
 * Every query is a fixed string in this file. They run as postgres, like the
 * local stack: --read-only would run them as Supabase's read-only role, which
 * can read the tables but not call the portal's functions (granted to no one).
 * --yes confirms the hosted run; --agent no keeps the JSON plain, the same in a
 * Claude session as in GitHub Actions.
 */
function sql(query) {
  const target = local
    ? process.env.SUPABASE_WORKDIR
      ? ["--workdir", process.env.SUPABASE_WORKDIR]
      : []
    : ["--remote", "--yes"];
  const out = execFileSync(
    "npx",
    ["supabase", "db", "query", ...target, "--agent", "no", "--output-format", "json", query],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return queryRows(out);
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

/** The issue already filed for this fingerprint (its marker is in the body), if any. */
function existingIssue(fingerprint) {
  const found = ghOrFail(
    ["issue", "list", "--repo", repo, "--state", "all", "--label", "error-report"].concat([
      "--search",
      `${fingerprint} in:body`,
      "--json",
      "number,body",
      "--limit",
      "5",
    ]),
  );
  return JSON.parse(found).find((issue) => fingerprintIn(issue.body) === fingerprint)?.number ?? null;
}

function record(fingerprint, status, issue, autofix) {
  if (dryRun) return;
  const number = Number.isInteger(issue) && issue > 0 ? issue : "null";
  sql(`select portal.record_triage('${fingerprint}', '${status}', ${number}, ${autofix})`);
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
  // The newest occurrence: its device and breadcrumbs go into the issue.
  const latest = sql(`select * from portal.latest_error_event('${group.fingerprint}')`)[0] ?? null;
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
      // An issue may already exist if recording it failed last time: never file twice.
      const filed = existingIssue(group.fingerprint);
      if (filed) {
        number = filed;
        ghOrFail(["issue", "edit", String(number), "--repo", repo, "--body-file", "-"], issueBody(group, repo, latest));
      } else {
        const url = ghOrFail(
          ["issue", "create", "--repo", repo, "--title", issueTitle(group), "--body-file", "-"].concat([
            "--label",
            "bug",
            "--label",
            "error-report",
          ]),
          issueBody(group, repo, latest),
        );
        number = Number(/\/issues\/(\d+)/.exec(url)?.[1]);
      }
    } else if (action.kind === "update" && fingerprintIn(issue.body) === group.fingerprint) {
      ghOrFail(["issue", "edit", String(number), "--repo", repo, "--body-file", "-"], issueBody(group, repo, latest));
    } else if (action.kind === "reopen") {
      ghOrFail(["issue", "reopen", String(number), "--repo", repo, "--comment", reopenComment(group, repo)]);
    } else if (action.kind === "close") {
      ghOrFail(
        ["issue", "close", String(number), "--repo", repo, "--reason", "not planned"].concat([
          "--comment",
          "Ignored from the portal's errors page.",
        ]),
      );
    } else if (action.kind === "restore") {
      ghOrFail([
        "issue",
        "reopen",
        String(number),
        "--repo",
        repo,
        "--comment",
        "Restored from the portal's errors page.",
      ]);
    }
  }

  const autofix = shouldAutofix(action, issue?.labels ?? [], usedToday, perDay);
  if (autofix) {
    usedToday += 1;
    if (number) fix.push(number);
  }
  record(group.fingerprint, action.kind === "ignore" || action.kind === "close" ? "ignored" : "filed", number, autofix);
  console.log(
    `${dryRun ? "[dry run] " : ""}${action.kind} ${number ? `#${number}` : "(new issue)"}: ` +
      `${issueTitle(group)}${autofix ? " -> Claude" : ""}`,
  );
  if (dryRun && action.kind === "file") console.log(issueBody(group, repo, latest));
}

console.log(`${groups.length} error groups triaged; ${fix.length} handed to Claude (${usedToday} of ${perDay} today).`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `fix=${JSON.stringify(fix)}\n`);

/** The one open issue whose body holds this marker, if any. */
function openIssueWith(marker) {
  const found = ghOrFail(
    ["issue", "list", "--repo", repo, "--state", "open", "--label", "error-report"].concat([
      "--search",
      `"${marker.slice(5, -4)}" in:body`,
      "--json",
      "number,body",
      "--limit",
      "5",
    ]),
  );
  return JSON.parse(found).find((issue) => issue.body.includes(marker))?.number ?? null;
}

/** Files, keeps or closes the issue that says the scheduled bank sync has stopped. */
function checkBankSync() {
  const health = syncHealthFrom(sql(SYNC_HEALTH_QUERY)[0]);
  const now = new Date();
  const number = openIssueWith(SYNC_MARKER);
  const action = decideSync(health, now, number !== null);
  console.log(`${dryRun ? "[dry run] " : ""}bank sync: ${action}${number ? ` #${number}` : ""}`);
  if (dryRun) {
    if (action === "file" || action === "update") console.log(syncIssueBody(health, now));
    return;
  }
  if (action === "file") {
    for (const [name, color, description] of LABELS) {
      gh(["label", "create", name, "--repo", repo, "--color", color, "--description", description]);
    }
    // Not handed to Claude: a stopped cron is a setting in Vercel, not a bug in the code.
    ghOrFail(
      ["issue", "create", "--repo", repo, "--title", SYNC_TITLE, "--body-file", "-"].concat([
        "--label",
        "bug",
        "--label",
        "error-report",
        "--label",
        NO_AUTOFIX,
      ]),
      syncIssueBody(health, now),
    );
  } else if (action === "update") {
    ghOrFail(["issue", "edit", String(number), "--repo", repo, "--body-file", "-"], syncIssueBody(health, now));
  } else if (action === "close") {
    ghOrFail(["issue", "close", String(number), "--repo", repo, "--comment", syncClosedComment(health)]);
  }
}

// After the error groups, and never in their way: a failure here warns on the run
// rather than failing it, so the bugs above still go to Claude.
try {
  checkBankSync();
} catch (error) {
  console.log(`::warning::Bank sync check failed: ${error instanceof Error ? error.message : error}`);
}

const SITE_TRIES = 3;
const SITE_WAIT_MS = 20_000;
const SITE_TIMEOUT_MS = 15_000;

/** One signed-out request: its status, where it redirects, and its page. Never throws. */
async function probe(base, path) {
  try {
    const response = await fetch(new URL(path, base), {
      redirect: "manual",
      signal: AbortSignal.timeout(SITE_TIMEOUT_MS),
      headers: { "user-agent": "portal-site-check" },
    });
    return { status: response.status, location: response.headers.get("location"), body: await response.text() };
  } catch {
    return { status: null, location: null, body: null };
  }
}

/**
 * Files, keeps or closes the issue that says the live portal is not loading. Tries
 * up to three times, 20 seconds apart, so one slow cold start files nothing. The
 * address is never printed: the run's log is public.
 */
async function checkSite() {
  const base = process.env.PORTAL_URL?.trim();
  if (!base) {
    console.log("site check: skipped (set the repository variable PORTAL_URL to turn it on)");
    return;
  }
  if (!URL.canParse(base)) throw new Error("PORTAL_URL is not an address");
  let health;
  let tries = 0;
  while (tries < SITE_TRIES) {
    if (tries > 0) await new Promise((resolve) => setTimeout(resolve, SITE_WAIT_MS));
    tries += 1;
    const [root, login] = await Promise.all([probe(base, "/"), probe(base, "/login")]);
    health = judgeSite({ root, login });
    if (health.healthy) break;
  }
  const number = openIssueWith(SITE_MARKER);
  const action = decideSite(health, number !== null);
  const failed = health.failed.map((f) => `${f.check} ${f.reason} ${f.status ?? "none"}`).join(", ");
  console.log(
    `${dryRun ? "[dry run] " : ""}site: ${action}${number ? ` #${number}` : ""}${failed ? ` (${failed})` : ""}`,
  );
  if (!health.healthy) console.log(`::warning::The portal is not loading: ${failed}`);
  if (dryRun) {
    if (action === "file" || action === "update") console.log(siteIssueBody(health, tries));
    return;
  }
  if (action === "file") {
    for (const [name, color, description] of LABELS) {
      gh(["label", "create", name, "--repo", repo, "--color", color, "--description", description]);
    }
    // Not handed to Claude: a site that won't load is a deploy or a setting, seen in Vercel.
    ghOrFail(
      ["issue", "create", "--repo", repo, "--title", SITE_TITLE, "--body-file", "-"].concat([
        "--label",
        "bug",
        "--label",
        "error-report",
        "--label",
        NO_AUTOFIX,
      ]),
      siteIssueBody(health, tries),
    );
  } else if (action === "update") {
    ghOrFail(["issue", "edit", String(number), "--repo", repo, "--body-file", "-"], siteIssueBody(health, tries));
  } else if (action === "close") {
    ghOrFail(["issue", "close", String(number), "--repo", repo, "--comment", SITE_CLOSED_COMMENT]);
  }
}

// Last, and like the bank sync check it only ever warns.
try {
  await checkSite();
} catch (error) {
  console.log(`::warning::Site check failed: ${error instanceof Error ? error.message : error}`);
}
