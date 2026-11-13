#!/usr/bin/env node
// The factory's guard: checks a branch against its base for the shortcuts an
// agent (or a tired human) might take to get a red check green. It runs in CI
// on every pull request (.github/workflows/guard.yml), and locally with
// `npm run guard` before a pull request is opened.
//
//   1. Migrations are append-only: a migration already on the base branch is
//      never edited, renamed or deleted, and a new one sorts after the newest.
//   2. The ratchets only tighten: eslint-suppressions.json and
//      e2e/a11y-baseline.json may shrink, never grow. Hiding a new lint breach
//      with `--suppress-all` fails here.
//   3. Existing tests and screenshot baselines are the owner's acceptance
//      checks. Adding them is free; changing or deleting one needs the PR label
//      "approved-test-change", which only the owner can add.
//
// Usage: node scripts/guard.mjs [base-ref]   (default origin/main)
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const base = process.argv[2] ?? process.env.GUARD_BASE ?? "origin/main";
const LABEL = "approved-test-change";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const atBase = (path) => {
  try {
    return git("show", `${base}:${path}`);
  } catch {
    return null;
  }
};

const mergeBase = git("merge-base", base, "HEAD");
// Status letter and path(s) of every file changed since the branch left base.
const changes = git("diff", "--name-status", "--find-renames", mergeBase)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split("\t");
    return { status: status[0], from: paths[0], to: paths[paths.length - 1] };
  });

const failures = [];

// 1. Migrations
const MIGRATIONS = "supabase/migrations/";
const baseMigrations = git("ls-tree", "--name-only", `${base}`, MIGRATIONS)
  .split("\n")
  .filter((p) => p.endsWith(".sql"))
  .sort();
const newest = baseMigrations.at(-1)?.slice(MIGRATIONS.length) ?? "";
for (const c of changes) {
  if (!c.from.startsWith(MIGRATIONS) && !c.to.startsWith(MIGRATIONS)) continue;
  if (c.status === "A") {
    const name = c.to.slice(MIGRATIONS.length);
    if (name <= newest)
      failures.push(`${c.to}: a new migration must sort after ${newest}. Rename it with a later timestamp.`);
  } else if (baseMigrations.includes(c.from)) {
    failures.push(
      `${c.from}: this migration is already on ${base} (and may be applied in production). Never edit it; add a new migration that changes what you need.`,
    );
  }
}

// 2. Ratchets
function suppressionTotals(json) {
  const totals = {};
  for (const rules of Object.values(json ?? {}))
    for (const [rule, { count }] of Object.entries(rules)) totals[rule] = (totals[rule] ?? 0) + count;
  return totals;
}
const readJson = (text) => (text ? JSON.parse(text) : {});
const nowSuppressions = suppressionTotals(
  existsSync("eslint-suppressions.json") ? JSON.parse(readFileSync("eslint-suppressions.json", "utf8")) : {},
);
// A branch that introduces a ratchet file sets its starting point.
const baseSuppressionsText = atBase("eslint-suppressions.json");
const baseSuppressions = suppressionTotals(readJson(baseSuppressionsText));
for (const [rule, count] of baseSuppressionsText === null ? [] : Object.entries(nowSuppressions)) {
  const before = baseSuppressions[rule] ?? 0;
  if (count > before)
    failures.push(
      `eslint-suppressions.json: ${rule} grew from ${before} to ${count}. Fix the new code instead of suppressing it.`,
    );
}
const a11yNow = existsSync("e2e/a11y-baseline.json") ? JSON.parse(readFileSync("e2e/a11y-baseline.json", "utf8")) : {};
const a11yBaseText = atBase("e2e/a11y-baseline.json");
const a11yBase = readJson(a11yBaseText);
for (const [page, rules] of a11yBaseText === null ? [] : Object.entries(a11yNow)) {
  const allowed = new Set(a11yBase[page] ?? []);
  for (const rule of rules)
    if (!allowed.has(rule))
      failures.push(`e2e/a11y-baseline.json: ${page} gained "${rule}". Fix the accessibility issue instead.`);
}

// 3. Acceptance checks
const PROTECTED = [/\.test\.ts$/, /^e2e\/.+\.spec\.ts$/, /^e2e\/__screenshots__\//, /^supabase\/tests\//];
const touched = changes.filter(
  (c) => (c.status === "M" || c.status === "D" || c.status === "R") && PROTECTED.some((re) => re.test(c.from)),
);
if (touched.length && !labels().includes(LABEL)) {
  failures.push(
    `These existing tests or screenshot baselines changed:\n${touched.map((c) => `    ${c.status} ${c.from}`).join("\n")}\n  ` +
      `They are acceptance checks, so changing them needs the owner's say-so: the PR label "${LABEL}". ` +
      `If the change is deliberate (a design change, a corrected test), say why in the PR description and ask the owner to add it.`,
  );
}

function labels() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path)) return (process.env.GUARD_LABELS ?? "").split(",").filter(Boolean);
  const event = JSON.parse(readFileSync(path, "utf8"));
  return (event.pull_request?.labels ?? []).map((l) => l.name);
}

if (failures.length) {
  console.error(`Guard: ${failures.length} problem(s) against ${base}\n`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}
console.log(`Guard: clean against ${base} (${changes.length} changed files).`);
