import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { OWNER_PAGES } from "../../../e2e/env.ts";
import { FOCI, SLOTS, focusFor, openLimit, planRun, runsPerDay, slotAt, slotRuns, type PlanInput } from "./foci.ts";

const root = new URL("../../../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/rnd.yml", root), "utf8");
const agent = readFileSync(new URL(".claude/agents/rnd.md", root), "utf8");

test("the workflow's schedule is the slots, in order", () => {
  const crons = [...workflow.matchAll(/^\s*- cron: "([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(crons, SLOTS);
});

test("the workflow offers every focus by hand, and the agent has a section for each", () => {
  const options = workflow
    .match(/options:\n((?:\s+- .+\n)+)/)?.[1]
    .match(/- (\S+)/g)
    ?.map((o) => o.slice(2));
  assert.deepEqual(options, ["auto", ...FOCI.map((f) => f.id)]);
  for (const f of FOCI) assert.match(agent, new RegExp(`^### ${f.name} \\(\`${f.id}\`\\)$`, "m"), f.id);
});

// Without StructuredOutput in the agent's tools, `claude --agent rnd --json-schema` ends
// "successfully" with no answer at all (found by a real run on 2026-11-19). The
// workflow's strict flags must keep the agent to reading and research.
test("the agent can answer in its JSON shape, and the workflow allows nothing else", () => {
  const tools = agent.match(/^tools: (.+)$/m)?.[1].split(/,\s*/);
  assert.deepEqual(tools, ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "StructuredOutput"]);
  assert.match(workflow, /--agent rnd\n/);
  assert.match(workflow, /--permission-mode default\n/);
  assert.match(workflow, /--disallowedTools "Bash,Edit,Write,NotebookEdit,mcp__\*,Read\(\.\/\.git\/\*\*\)"/);
  assert.match(workflow, /ENABLE_CLAUDEAI_MCP_SERVERS: "false"/);
});

test("every focus points at paths and pages that exist", () => {
  const pages = new Set(OWNER_PAGES.map((p) => p.path));
  assert.equal(new Set(FOCI.map((f) => f.id)).size, FOCI.length, "ids are unique");
  for (const f of FOCI) {
    for (const p of f.paths) assert.ok(existsSync(new URL(p, root)), `${f.id}: ${p}`);
    for (const p of f.pages ?? []) assert.ok(pages.has(p), `${f.id}: ${p} is not in e2e/env.ts`);
  }
});

test("the settings fall back to their defaults and stay in range", () => {
  assert.equal(runsPerDay(undefined), 4);
  assert.equal(runsPerDay(""), 4);
  assert.equal(runsPerDay("two"), 4);
  assert.equal(runsPerDay("0"), 0);
  assert.equal(runsPerDay("9"), 4);
  assert.equal(openLimit(undefined), 8);
  assert.equal(openLimit("0"), 1);
  assert.equal(openLimit("12"), 12);
});

test("fewer runs a day are spread through it, the first slot first", () => {
  const on = (n: number) => SLOTS.map((_, slot) => slotRuns(slot, n));
  assert.deepEqual(on(4), [true, true, true, true]);
  assert.deepEqual(on(3), [true, false, true, true]);
  assert.deepEqual(on(2), [true, false, true, false]);
  assert.deepEqual(on(1), [true, false, false, false]);
  assert.deepEqual(on(0), [false, false, false, false]);
});

test("the slot for an hour is the latest that has started", () => {
  assert.equal(slotAt(3), 0);
  assert.equal(slotAt(6), 0);
  assert.equal(slotAt(12), 1);
  assert.equal(slotAt(23), 3);
});

test("the rotation reaches every focus, one run after another, at any number of runs a day", () => {
  for (const n of [1, 2, 3, 4]) {
    const seen: string[] = [];
    for (let d = 0; seen.length < FOCI.length * 2; d++) {
      const day = new Date(Date.UTC(2026, 10, 19 + d)).toISOString().slice(0, 10);
      for (let slot = 0; slot < SLOTS.length; slot++) if (slotRuns(slot, n)) seen.push(focusFor(day, slot, n).id);
    }
    assert.equal(new Set(seen.slice(0, FOCI.length)).size, FOCI.length, `${n} a day`);
    // Consecutive runs take consecutive foci, so none waits longer than the others.
    for (let i = 1; i < seen.length; i++) {
      const prev = FOCI.findIndex((f) => f.id === seen[i - 1]);
      assert.equal(seen[i], FOCI[(prev + 1) % FOCI.length].id, `${n} a day, run ${i}`);
    }
  }
});

const base: PlanInput = {
  event: "schedule",
  schedule: SLOTS[0],
  focus: "",
  perDay: undefined,
  openLimit: undefined,
  open: 0,
  day: "2026-11-19",
  hour: 6,
};

test("a scheduled run goes ahead on the rotation's focus", () => {
  const plan = planRun(base);
  assert.equal(plan.run, true);
  assert.equal(plan.run && plan.focus.id, focusFor("2026-11-19", 0, 4).id);
});

test("R&D pauses itself while enough proposals wait for the owner", () => {
  assert.equal(planRun({ ...base, open: 7 }).run, true);
  const full = planRun({ ...base, open: 8 });
  assert.equal(full.run, false);
  assert.match(full.why, /8 proposals are waiting/);
  assert.equal(planRun({ ...base, open: 8, openLimit: "10" }).run, true);
});

test("the owner's settings and unknown events stop a scheduled run", () => {
  assert.equal(planRun({ ...base, perDay: "0" }).run, false);
  assert.equal(planRun({ ...base, schedule: SLOTS[1], perDay: "2" }).run, false);
  assert.equal(planRun({ ...base, schedule: "0 0 * * *" }).run, false);
  assert.equal(planRun({ ...base, event: "push" }).run, false);
});

test("a run by hand always goes ahead, on the chosen focus or the rotation's", () => {
  const chosen = planRun({ ...base, event: "workflow_dispatch", focus: "gym", perDay: "0", open: 30 });
  assert.equal(chosen.run && chosen.focus.id, "gym");
  const auto = planRun({ ...base, event: "workflow_dispatch", focus: "auto", hour: 15 });
  assert.equal(auto.run && auto.focus.id, focusFor("2026-11-19", 2, 4).id);
});
