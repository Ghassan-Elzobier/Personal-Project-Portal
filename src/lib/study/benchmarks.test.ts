import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBenchmarks, type BenchmarkRow } from "./benchmarks.ts";

const row = (over: Partial<BenchmarkRow>): BenchmarkRow => ({
  gid: "1",
  project: "rendering",
  task_gid: null,
  metric: "Frame time",
  value: 10,
  unit: "ms",
  scene: "spheres",
  gpu: "Iris Xe",
  commit_sha: null,
  notes: "",
  created_at: "2026-11-05T00:00:00Z",
  ...over,
});

test("results from different scenes or GPUs are never compared", () => {
  const groups = groupBenchmarks([row({}), row({ scene: "sponza" }), row({ gpu: "RTX 4070" })]);
  assert.equal(groups.length, 3);
  assert.ok(groups.every((g) => g.changePercent === null));
});

test("a lower frame time counts as an improvement", () => {
  const [g] = groupBenchmarks([row({ value: "10" }), row({ value: "8", gid: "2" })]);
  assert.equal(g.changePercent, -20);
  assert.equal(g.improved, true);
  assert.equal(g.latest.gid, "2");
  assert.deepEqual(g.values, [10, 8]);
});

test("a lower ray rate counts as a regression", () => {
  const [g] = groupBenchmarks([
    row({ metric: "Million rays per second", value: 100 }),
    row({ metric: "Million rays per second", value: 90 }),
  ]);
  assert.equal(g.improved, false);
});

test("an unknown metric reports the change without judging it", () => {
  const [g] = groupBenchmarks([row({ metric: "Custom", value: 2 }), row({ metric: "Custom", value: 3 })]);
  assert.equal(g.changePercent, 50);
  assert.equal(g.improved, null);
});

test("a zero starting value gives no percentage", () => {
  const [g] = groupBenchmarks([row({ value: 0 }), row({ value: 3 })]);
  assert.equal(g.changePercent, null);
});
