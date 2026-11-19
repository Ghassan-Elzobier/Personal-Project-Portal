import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOCI, SLOTS, type Focus, type PlanInput } from "./foci.ts";
import { fromRun, issueBody, updateComment, type Context } from "./issue.ts";
import type { Proposal } from "./result.ts";
import { filingOrder, planSweep, readAnswer, type Publishable } from "./sweep.ts";

const workflow = readFileSync(new URL("../../../.github/workflows/rnd.yml", import.meta.url), "utf8");
const ids = FOCI.map((f) => f.id);
const focus = (id: string): Focus => {
  const found = FOCI.find((f) => f.id === id);
  assert.ok(found, id);
  return found;
};

const byHand: PlanInput & { all: boolean } = {
  event: "workflow_dispatch",
  schedule: "",
  focus: "auto",
  all: true,
  perDay: undefined,
  openLimit: undefined,
  open: 0,
  day: "2026-11-19",
  hour: 15,
};
const scheduled = { ...byHand, event: "schedule", schedule: SLOTS[0], hour: 6 };

test("by hand, all means every focus at once, whatever waits and whatever the schedule is set to", () => {
  const sweep = planSweep({ ...byHand, focus: "gym", perDay: "0", open: 30 });
  assert.deepEqual(sweep.run && sweep.foci.map((f) => f.id), ids);
});

test("without all, a run by hand takes one focus", () => {
  const chosen = planSweep({ ...byHand, all: false, focus: "gym" });
  assert.deepEqual(chosen.run && chosen.foci.map((f) => f.id), ["gym"]);
  const rotation = planSweep({ ...byHand, all: false });
  assert.equal(rotation.run && rotation.foci.length, 1);
});

test("the schedule never sweeps, and still pauses while proposals wait", () => {
  const one = planSweep(scheduled);
  assert.equal(one.run && one.foci.length, 1);
  const paused = planSweep({ ...scheduled, open: 8 });
  assert.equal(paused.run, false);
  assert.match(paused.why, /8 proposals are waiting/);
});

test("the workflow offers the sweep by hand, off unless asked for", () => {
  assert.match(workflow, /^ {6}all:\n {8}description: .+\n {8}type: boolean\n {8}default: false$/m);
  assert.match(workflow, /^ {10}ALL_INPUT: \$\{\{ inputs\.all \}\}$/m);
});

test("each focus has a research job of its own, which hands its answer on under its own name", () => {
  assert.match(workflow, /^ {6}fail-fast: false$/m);
  assert.match(workflow, /^ {8}focus: \$\{\{ fromJSON\(needs\.plan\.outputs\.foci\) \}\}$/m);
  const outputs = [
    ...workflow.matchAll(
      /^ {6}([a-z-]+): \$\{\{ matrix\.focus == '([a-z-]+)' && steps\.claude\.outputs\.structured_output \|\| '' \}\}$/gm,
    ),
  ];
  assert.deepEqual(
    outputs.map((m) => m[1]),
    ids,
    "one output per focus, in order",
  );
  assert.deepEqual(
    outputs.map((m) => m[2]),
    ids,
    "each filled in only by its own focus's job",
  );
});

test("one job files every answer, even when part of the research failed, and only it can write", () => {
  assert.match(workflow, /^ {4}needs: \[plan, research\]$/m);
  assert.match(
    workflow,
    /^ {4}if: \$\{\{ !cancelled\(\) && needs\.plan\.result == 'success' && needs\.plan\.outputs\.foci != '\[\]' \}\}$/m,
  );
  assert.match(workflow, /^ {10}FOCI: \$\{\{ needs\.plan\.outputs\.foci \}\}$/m);
  assert.match(workflow, /^ {10}RESULTS: \$\{\{ toJSON\(needs\.research\.outputs\) \}\}$/m);
  assert.deepEqual(
    [...workflow.matchAll(/^ +([a-z-]+): write$/gm)].map((m) => m[1]),
    ["issues"],
  );
});

// Made-up, like every answer in these tests.
const proposal: Proposal = {
  title: "Suggest the next weight from the last session",
  serves: "gym",
  problem: "The gym page shows last week's sets but leaves the next weight to memory.",
  evidence: [{ where: "/life/gym", what: "The page shot has no suggestion." }],
  research: [
    { source: "Example Society, Progression, 2024", url: "https://example.org/progression", finding: "Small steps." },
  ],
  change: "Show the suggested weight beside each exercise.",
  acceptance: ["The gym page shows a suggested weight."],
  considered: "A chart.",
  risks: "A wrong suggestion.",
  size: "small",
  impact: 4,
  confidence: 3,
};
const answer = (changes: object = {}) =>
  JSON.stringify({ outcome: "proposal", looked_at: "The gym page.", proposal: { ...proposal, ...changes } });

test("an answer that passes its checks is ready to file", () => {
  const read = readAnswer(focus("gym"), answer({ acceptance: ["one", "two", "three", "four"] }));
  assert.ok("result" in read);
  assert.equal(read.result.outcome === "proposal" && read.result.proposal.title, proposal.title);
  assert.deepEqual(read.trimmed, ["acceptance"]);
  const nothing = readAnswer(focus("gym"), JSON.stringify({ outcome: "nothing", looked_at: "The gym page." }));
  assert.equal("result" in nothing && nothing.result.outcome, "nothing");
});

test("a missing, broken, private or leaky answer is a problem that names its focus and none of its text", () => {
  const problem = (raw: string | undefined): string => {
    const read = readAnswer(focus("gym"), raw);
    assert.ok("problem" in read);
    return read.problem;
  };
  for (const raw of [undefined, "", "  \n"]) assert.match(problem(raw), /^The gym focus finished without an answer/);
  assert.equal(problem("{oops"), "The gym focus gave an answer that was not JSON.");
  assert.match(
    problem(JSON.stringify({ outcome: "proposal", looked_at: "x" })),
    /^The gym focus gave an answer that failed its checks: proposal is missing/,
  );

  const secret = JSON.stringify({ outcome: "private", area: "sign-in", looked_at: "the hole is in the callback" });
  assert.match(problem(secret), /^The gym focus found a security weakness in the "sign-in" area/);
  assert.equal(problem(secret).includes("callback"), false);

  const leaky = problem(answer({ risks: "mail someone@gmail.com" }));
  assert.match(leaky, /^The gym focus gave an answer that looked as if it held an email address\./);
  assert.equal(leaky.includes("someone"), false);
});

test("answers are filed weakest first, so the strongest is the newest issue and the first one read", () => {
  const scored = (id: string, impact: number, confidence: number, size: Proposal["size"] = "small") => {
    const result: Publishable = {
      outcome: "proposal",
      lookedAt: "x",
      proposal: { ...proposal, impact, confidence, size },
    };
    return { id, result };
  };
  const nothing: Publishable = { outcome: "nothing", lookedAt: "x" };
  const order = filingOrder([
    scored("strong", 5, 4),
    { id: "nothing", result: nothing },
    scored("weak", 2, 2),
    scored("large", 4, 3, "large"),
    scored("small", 3, 4, "small"),
  ]);
  assert.deepEqual(
    order.map((a) => a.id),
    ["nothing", "weak", "large", "small", "strong"],
  );
});

test("a rerun knows what its run already wrote, for that focus and that run only", () => {
  const ctx: Context = {
    repo: "someone/portal",
    sha: "abc1234",
    day: "2026-11-19",
    runUrl: "https://github.com/someone/portal/actions/runs/12",
    isFile: () => false,
  };
  const [gym, food] = [focus("gym"), focus("food")];
  for (const text of [issueBody(gym, proposal, ctx), updateComment(gym, proposal, ctx)]) {
    assert.equal(fromRun(text, gym, ctx.runUrl), true);
    assert.equal(fromRun(text, food, ctx.runUrl), false, "another focus");
    assert.equal(fromRun(text, gym, "https://github.com/someone/portal/actions/runs/1"), false, "another run");
    assert.equal(fromRun(text, gym, `${ctx.runUrl}3`), false, "a run whose number starts the same");
  }
});
