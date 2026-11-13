#!/usr/bin/env node
// Whether the factory is getting better: one row a week in docs/factory/metrics.md.
// The /improve-factory pass appends it; read the trend, not one week.
//
//   merged        pull requests merged in the last 7 days
//   lead time     median hours from opening a pull request to merging it
//   CI first try  share of CI runs on pull requests that passed (higher: work arrives ready)
//   review notes  review comments on those pull requests (lower: fewer misses)
//   suppressed    known lint breaches still in the ratchet (lower is better)
//   a11y          accessibility findings still in the baseline
//   tests         unit tests + end-to-end test definitions
//
// Needs `gh` signed in. Usage: npm run factory:metrics
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

const ghJson = (args) => {
  try {
    return JSON.parse(sh("gh", args));
  } catch {
    console.error(`gh ${args.slice(0, 2).join(" ")} failed (signed out, offline or an old gh): that column is blank.`);
    return [];
  }
};
const merged = ghJson([
  "pr",
  "list",
  "--state",
  "merged",
  "--search",
  `merged:>=${since}`,
  "--json",
  "number,createdAt,mergedAt",
]);
const runs = ghJson([
  "run",
  "list",
  "--workflow",
  "CI",
  "--event",
  "pull_request",
  "--limit",
  "200",
  "--json",
  "conclusion,createdAt",
]).filter((r) => r.createdAt >= since);

const hours = merged.map((p) => (new Date(p.mergedAt) - new Date(p.createdAt)) / 3_600_000).sort((a, b) => a - b);
const median = hours.length ? hours[Math.floor(hours.length / 2)].toFixed(1) : "–";
const finished = runs.filter((r) => r.conclusion === "success" || r.conclusion === "failure");
const firstTry = finished.length
  ? `${Math.round((100 * finished.filter((r) => r.conclusion === "success").length) / finished.length)}%`
  : "–";

let notes = 0;
for (const p of merged) {
  try {
    notes += Number(sh("gh", ["api", `repos/{owner}/{repo}/pulls/${p.number}/comments`, "--jq", "length"]));
  } catch {
    // Counted as none.
  }
}

const suppressions = JSON.parse(readFileSync("eslint-suppressions.json", "utf8"));
let suppressed = 0;
for (const rules of Object.values(suppressions)) for (const { count } of Object.values(rules)) suppressed += count;
const a11y = Object.values(JSON.parse(readFileSync("e2e/a11y-baseline.json", "utf8"))).flat().length;

const countMatches = (dir, re, test) => {
  let n = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !re.test(entry.name)) continue;
    n += (readFileSync(`${entry.parentPath}/${entry.name}`, "utf8").match(test) ?? []).length;
  }
  return n;
};
const unit = countMatches("src", /\.test\.ts$/, /^\s*test\(/gm);
const e2e = countMatches("e2e", /\.spec\.ts$/, /^\s*test\(/gm);

const today = new Date().toISOString().slice(0, 10);
console.log(
  `| ${today} | ${merged.length} | ${median} | ${firstTry} | ${notes} | ${suppressed} | ${a11y} | ${unit} + ${e2e} |`,
);
