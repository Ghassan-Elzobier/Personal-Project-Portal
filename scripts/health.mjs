#!/usr/bin/env node
// The refactor queue: what most needs improving, ranked, so a refactor run (the
// /refactor skill or the weekly routine) always knows what to do next.
//
//   1. Known rule breaches, from eslint-suppressions.json (the ratchet).
//   2. Unused code, from knip.
//   3. Accessibility debt, from e2e/a11y-baseline.json.
//   4. Hotspots: big files that change often (lines x commits in 90 days). Complex
//      code that keeps changing is where structure pays off most (Tornhill,
//      "Your Code as a Crime Scene").
//
// Usage: npm run health  (add --json for machine-readable output)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const json = process.argv.includes("--json");
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return e.stdout ?? "";
  }
};

// 1. Suppressed breaches, by rule and by file.
const suppressions = existsSync("eslint-suppressions.json")
  ? JSON.parse(readFileSync("eslint-suppressions.json", "utf8"))
  : {};
const byRule = {};
const byFile = [];
for (const [file, rules] of Object.entries(suppressions)) {
  let total = 0;
  for (const [rule, { count }] of Object.entries(rules)) {
    byRule[rule] = (byRule[rule] ?? 0) + count;
    total += count;
  }
  byFile.push({ file, total, rules: Object.keys(rules) });
}
byFile.sort((a, b) => b.total - a.total);

// 2. Unused code.
let unused = 0;
try {
  const report = JSON.parse(run("npx", ["knip", "--reporter", "json"]) || "{}");
  for (const issue of report.issues ?? [])
    for (const [key, value] of Object.entries(issue))
      if (Array.isArray(value) && key !== "file") unused += value.length;
} catch {
  unused = -1;
}

// 3. Accessibility debt.
const a11y = existsSync("e2e/a11y-baseline.json") ? JSON.parse(readFileSync("e2e/a11y-baseline.json", "utf8")) : {};
const a11yCount = Object.values(a11y).reduce((n, rules) => n + rules.length, 0);

// 4. Hotspots.
const churn = {};
for (const line of run("git", ["log", "--since=90.days", "--name-only", "--format="]).split("\n"))
  if (/^src\/.+\.(ts|tsx)$/.test(line) && !line.endsWith(".test.ts")) churn[line] = (churn[line] ?? 0) + 1;
const hotspots = Object.entries(churn)
  .filter(([file]) => existsSync(file))
  .map(([file, commits]) => {
    const lines = readFileSync(file, "utf8").split("\n").length;
    return { file, lines, commits, score: lines * commits };
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 8);

const totals = {
  suppressed: Object.values(byRule).reduce((a, b) => a + b, 0),
  unused,
  a11y: a11yCount,
};

if (json) {
  console.log(JSON.stringify({ totals, byRule, byFile: byFile.slice(0, 10), hotspots }, null, 2));
  process.exit(0);
}

console.log(
  `Refactor queue: ${totals.suppressed} suppressed breaches, ${unused} unused items, ${a11yCount} accessibility findings\n`,
);
console.log("Breaches by rule (fix the rule with the clearest win first):");
for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(count).padStart(4)}  ${rule}`);
console.log("\nFiles with the most breaches:");
for (const f of byFile.slice(0, 8)) console.log(`  ${String(f.total).padStart(4)}  ${f.file}  (${f.rules.join(", ")})`);
if (a11yCount) {
  console.log("\nAccessibility findings to fix (then remove from e2e/a11y-baseline.json):");
  for (const [page, rules] of Object.entries(a11y)) console.log(`        ${page}: ${rules.join(", ")}`);
}
console.log("\nHotspots, lines x commits in 90 days (split or simplify the top ones when you next change them):");
for (const h of hotspots)
  console.log(`  ${String(h.score).padStart(6)}  ${h.file}  (${h.lines} lines, ${h.commits} commits)`);
console.log("\nOpen refactor issues come first: gh issue list --label refactor");
