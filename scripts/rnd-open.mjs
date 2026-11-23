#!/usr/bin/env node
// Opens an R&D build's pull request under the owner's account (.github/workflows/rnd-build.yml).
//
// Runs in a job of its own, on a fresh runner that Claude never touched, after the
// build pushed its branch and wrote what the pull request should say into
// .rnd-pr/ (handed over as an artifact, downloaded to PR_DIR). The owner's token
// (OWNER_TOKEN) is used for one thing, creating the pull request; the issue
// comment goes out with the job's own token (COMMENT_TOKEN).
//
//   node --experimental-strip-types scripts/rnd-open.mjs
//
// Env: ISSUE, REPO (owner/name), PR_DIR, OWNER_TOKEN, COMMENT_TOKEN, GITHUB_STEP_SUMMARY.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyOf, branchFor, titleOf } from "../src/lib/rnd/open.ts";

const env = process.env;
const say = (line) => {
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** gh with the given token and nothing else from this job's environment that gh would read. */
function gh(args, token) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    env: { PATH: env.PATH, HOME: env.HOME, GH_TOKEN: token, GH_PROMPT_DISABLED: "1" },
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

const n = Number(env.ISSUE);
if (!Number.isInteger(n) || n <= 0) fail("ISSUE (the proposal's number) is required.");
const repo = env.REPO ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail("REPO (owner/name) is required.");
const dir = env.PR_DIR ?? "pr";
const file = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null);

const rawBranch = file("branch.txt");
if (rawBranch === null) {
  // The build said on the issue why it built nothing, and its own job checked that it did.
  say(`#${n}: Claude asked for no pull request, so there is nothing to open.`);
  process.exit(0);
}
const branch = branchFor(n, rawBranch);
if (!branch)
  fail(`#${n}: the branch Claude named, '${rawBranch.trim().slice(0, 80)}', isn't claude/rnd-${n}-<short-name>.`);
const title = titleOf(file("title.txt") ?? "");
if (!title) fail(`#${n}: Claude wrote no title for the pull request of '${branch}'.`);
const body = bodyOf(file("body.md") ?? "", n);

const owner = env.OWNER_TOKEN ?? "";
if (!owner)
  fail(
    `#${n}: the OWNER_PR_TOKEN secret is missing, so the pull request can't open under the owner's account. ` +
      `'${branch}' is pushed: open its pull request by hand, and add the secret (docs/FACTORY.md, setup step 11).`,
  );

if (!gh(["api", `repos/${repo}/git/ref/heads/${branch}`, "--jq", ".ref"], owner).ok)
  fail(`#${n}: Claude named '${branch}', but no such branch was pushed.`);
const [ownerName] = repo.split("/");
const already = gh(
  [
    "api",
    `repos/${repo}/pulls?state=open&head=${ownerName}:${encodeURIComponent(branch)}`,
    "--jq",
    ".[0].html_url // empty",
  ],
  owner,
);
let url = already.ok ? already.out : "";
if (url) say(`#${n}: '${branch}' already has a pull request open: ${url}`);
else {
  const bodyFile = join(mkdtempSync(join(tmpdir(), "rnd-pr-")), "body.md");
  writeFileSync(bodyFile, body);
  const made = gh(
    [
      "api",
      "-X",
      "POST",
      `repos/${repo}/pulls`,
      "-f",
      `title=${title}`,
      "-f",
      `head=${branch}`,
      "-f",
      "base=main",
      "-F",
      `body=@${bodyFile}`,
      "--jq",
      ".html_url",
    ],
    owner,
  );
  if (!made.ok) fail(`#${n}: GitHub refused the pull request for '${branch}': ${made.err.slice(0, 300)}`);
  url = made.out;
  say(`#${n}: opened ${url} under the owner's account.`);
}

const comment = env.COMMENT_TOKEN ?? "";
if (comment && url) {
  const said = gh(["api", "-X", "POST", `repos/${repo}/issues/${n}/comments`, "-f", `body=Built: ${url}`], comment);
  if (!said.ok) say(`#${n}: the pull request is open, but the comment on the issue failed: ${said.err.slice(0, 200)}`);
}
