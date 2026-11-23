import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// A run one workflow starts with `gh workflow run` and its own token has GitHub
// Actions itself as its actor, and the Claude action refuses a run a bot started
// unless the bot is in `allowed_bots`. The conflict fixer's dispatched run failed
// on exactly that ("Workflow initiated by non-human actor: github-actions") the
// first time it was needed, after #134 merged and #136 conflicted.

const root = new URL("../../../", import.meta.url);
const WORKFLOWS = ".github/workflows/";
const read = (file: string) => readFileSync(new URL(WORKFLOWS + file, root), "utf8");
const files = readdirSync(new URL(WORKFLOWS, root)).filter((f) => /\.ya?ml$/.test(f));

/** Each job under `jobs:`, by id, with its text. */
function jobs(workflow: string): Map<string, string> {
  const body = workflow.split(/^jobs:\n/m)[1] ?? "";
  const out = new Map<string, string>();
  for (const part of body.split(/^ {2}(?=[a-zA-Z0-9_-]+:\s*$)/m).filter((p) => p.trim()))
    out.set(part.slice(0, part.indexOf(":")), part);
  return out;
}

/** The bots a job's Claude step lets start it. */
const allowed = (job: string) =>
  (job.match(/^ +allowed_bots: *(.+)$/m)?.[1] ?? "")
    .replace(/["']/g, "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

test("a workflow a workflow dispatches lets GitHub Actions start its Claude jobs, and only that bot", () => {
  const dispatched = new Set(
    files.flatMap((f) => [...read(f).matchAll(/gh workflow run ([\w.-]+\.ya?ml)/g)].map((m) => m[1])),
  );
  assert.ok(dispatched.has("pr-conflicts.yml"), [...dispatched].join(", "));
  let checked = 0;
  for (const file of dispatched) {
    for (const [id, job] of jobs(read(file))) {
      if (!job.includes("anthropics/claude-code-action@")) continue;
      checked++;
      assert.ok(allowed(job).includes("github-actions"), `${file}: job '${id}' refuses the run it was dispatched in`);
    }
  }
  assert.ok(checked > 0, "the conflict fixer has a Claude job");
});

test("no workflow lets every bot start Claude", () => {
  for (const file of files)
    for (const [id, job] of jobs(read(file)))
      assert.equal(allowed(job).includes("*"), false, `${file}: job '${id}' allows any bot`);
  // The review still lets Claude's own pushes be reviewed.
  assert.deepEqual(allowed(jobs(read("claude-review.yml")).get("review") ?? ""), ["claude"]);
});
