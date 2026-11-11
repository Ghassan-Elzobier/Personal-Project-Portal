import { test } from "node:test";
import assert from "node:assert/strict";
import { excerptForClaude, planSearch, splitExcerpt } from "./query.ts";

test("a Vulkan word also searches for the book's CUDA word", () => {
  const plan = planSearch("subgroup ballot");
  assert.deepEqual(plan.groups, [["subgroup", "warp"], ["ballot", "vote"]]);
  assert.deepEqual(plan.translated.map((t) => t.from), ["subgroup", "ballot"]);
});

test("multi-word terms are matched before single words", () => {
  const plan = planSearch("how do push constants compare to a storage buffer");
  assert.deepEqual(plan.groups[0], ["storage buffer", "global memory"]);
  assert.deepEqual(plan.groups[1], ["push constants", "constant memory"]);
  assert.ok(!plan.groups.some((g) => g[0] === "push" || g[0] === "buffer"));
});

test("question words drop out, so they cannot hide every page", () => {
  const plan = planSearch("What does PMPP explain about occupancy?");
  assert.deepEqual(plan.groups, [["occupancy"]]);
});

test("quoted phrases stay exact", () => {
  const plan = planSearch('"thread coarsening" shared');
  assert.deepEqual(plan.groups[0], ["thread coarsening"]);
  assert.deepEqual(plan.groups[1], ["shared", "shared memory"]);
});

test("GLSL built-ins keep their underscores", () => {
  const plan = planSearch("gl_GlobalInvocationID and __syncthreads()");
  assert.deepEqual(plan.groups[0], ["gl_GlobalInvocationID", "blockidx", "threadidx"]);
  assert.deepEqual(plan.groups[1], ["__syncthreads"]);
});

test("the same idea is not searched twice, and long questions are capped", () => {
  assert.equal(planSearch("warp warp WARP").groups.length, 1);
  const long = Array.from({ length: 30 }, (_, i) => `term${i}`).join(" ");
  assert.equal(planSearch(long).groups.length, 12);
});

test("excerpts split into plain and marked runs, never HTML", () => {
  const runs = splitExcerpt("a \u0001warp\u0002 of <b>32</b> \u0001threads\u0002");
  assert.deepEqual(runs, [
    { text: "a ", mark: false },
    { text: "warp", mark: true },
    { text: " of <b>32</b> ", mark: false },
    { text: "threads", mark: true },
  ]);
  assert.equal(excerptForClaude("a \u0001warp\u0002\n  runs"), "a **warp** runs");
});
