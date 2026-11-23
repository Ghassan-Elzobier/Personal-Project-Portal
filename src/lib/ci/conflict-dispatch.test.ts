import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conflictMarker } from "./conflicts.ts";

// The conflict fixer (.github/workflows/pr-conflicts.yml) once never ran: it called the
// Claude action from a push run, and the action refuses push events ("Unsupported event
// type: push"). These checks hold every workflow to that, and hold the fixer to its
// two-run shape: the push run checks and dispatches, the dispatched run resolves.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const WORKFLOWS = ".github/workflows/";

/** The top-level `on:` block's event names. */
function events(workflow: string): string[] {
  const block = workflow.match(/^on:\n((?:(?: .*)?\n)*)/m)?.[1] ?? "";
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}

/** Each job under `jobs:`, by id, with its text. */
function jobs(workflow: string): Map<string, string> {
  const body = workflow.split(/^jobs:\n/m)[1] ?? "";
  const out = new Map<string, string>();
  const parts = body.split(/^ {2}(?=[a-zA-Z0-9_-]+:\s*$)/m).filter((p) => p.trim());
  for (const part of parts) out.set(part.slice(0, part.indexOf(":")), part);
  return out;
}

/** A job's `if:`, folded onto one line (it may be a `>-` or `|` block). */
function condition(job: string): string {
  const m = job.match(/^ {4}if: *(.*)\n((?: {6,}.*\n)*)/m);
  if (!m) return "";
  return [m[1].replace(/^[>|]-?$/, ""), m[2]].join(" ").replace(/\s+/g, " ").trim();
}

test("no job that runs the Claude action can start on a push, which the action refuses", () => {
  const files = readdirSync(new URL(WORKFLOWS, root)).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes("pr-conflicts.yml"), files.join(", "));
  let checked = 0;
  for (const file of files) {
    const workflow = read(WORKFLOWS + file);
    if (!events(workflow).includes("push")) continue;
    for (const [id, job] of jobs(workflow)) {
      if (!job.includes("anthropics/claude-code-action@")) continue;
      checked++;
      assert.match(
        condition(job),
        /github\.event_name != 'push'/,
        `${file}: job '${id}' runs the Claude action and can run on push`,
      );
    }
  }
  assert.ok(checked > 0, "pr-conflicts.yml runs on push and has a Claude job");
});

test("the trigger reader sees what each workflow starts on", () => {
  assert.deepEqual(events(read(WORKFLOWS + "pr-conflicts.yml")), ["push", "workflow_dispatch"]);
  assert.deepEqual(events(read(WORKFLOWS + "ci-triage.yml")), ["workflow_run"]);
  const fixture =
    "on:\n  push:\n    branches: [main]\n\njobs:\n  a:\n    if: >-\n      github.event_name != 'push'\n      && true\n    steps: []\n  b:\n    steps: []\n";
  assert.deepEqual(events(fixture), ["push"]);
  assert.deepEqual([...jobs(fixture).keys()], ["a", "b"]);
  assert.equal(condition(jobs(fixture).get("a")!), "github.event_name != 'push' && true");
  assert.equal(condition(jobs(fixture).get("b")!), "");
});

test("a push run hands a conflict fix to a dispatched run, and only when there is one", () => {
  const workflow = read(WORKFLOWS + "pr-conflicts.yml");
  const check = jobs(workflow).get("check")!;
  assert.match(check, /^ {4}permissions:\n(?: {6}.*\n)*? {6}actions: write$/m);
  const steps = check.split(/^ {6}- /m).slice(1);
  const dispatch = steps.at(-1)!;
  assert.match(dispatch, /run: gh workflow run pr-conflicts\.yml --ref main\b/);
  assert.match(
    dispatch,
    /^ {8}if: github\.event_name == 'push' && steps\.check\.outputs\.fix != '' && steps\.check\.outputs\.fix != '\[\]'$/m,
  );
  // The dispatch is the last step, so the concurrency group cancelling the push run loses nothing.
  assert.ok(steps.findIndex((s) => s.startsWith("id: check")) === steps.length - 2, steps.join("---"));
  // Only the check job can dispatch; the resolve job keeps read access to actions.
  assert.match(jobs(workflow).get("resolve")!, /^ {6}actions: read$/m);
});

test("the dispatched run still fixes a pull request the push run already commented on, without a second comment", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-conflicts-"));
  try {
    const head = "1111111111111111111111111111111111111111";
    const prs = [
      {
        number: 7,
        headRefName: "claude/example",
        headRefOid: head,
        isCrossRepository: false,
        mergeable: "CONFLICTING",
        labels: [],
        comments: [{ body: `${conflictMarker(head)}\n<!-- conflict-fix -->\nAsking Claude (attempt 1 of 2).` }],
      },
    ];
    writeFileSync(join(dir, "prs.json"), JSON.stringify(prs));
    // Fake gh and git: list the pull request, refuse (and record) any comment, report one conflicted file.
    const gh = `#!/bin/sh\nif [ "$1 $2" = "pr list" ]; then cat "${dir}/prs.json"; exit 0; fi\necho "$@" >> "${dir}/gh-calls"\nexit 1\n`;
    const git = `#!/bin/sh\nif [ "$1" = "merge-tree" ]; then printf 'abc\\ndocs/factory/friction.md\\n\\n'; fi\nexit 0\n`;
    for (const [name, body] of [
      ["gh", gh],
      ["git", git],
    ]) {
      writeFileSync(join(dir, name), body);
      chmodSync(join(dir, name), 0o755);
    }
    const output = join(dir, "output");
    writeFileSync(output, "");
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "scripts/pr-conflicts.mjs", "--dry-run"],
      {
        cwd: new URL(root).pathname,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: "example/repo",
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(output, "utf8"), 'fix=[{"pr":7,"branch":"claude/example"}]\n');
    assert.doesNotMatch(r.stdout, /\[dry run\] comment/);
    assert.match(r.stdout, /#7 claude\/example: conflicts in docs\/factory\/friction\.md -> Claude/);
    assert.throws(() => readFileSync(join(dir, "gh-calls")), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
