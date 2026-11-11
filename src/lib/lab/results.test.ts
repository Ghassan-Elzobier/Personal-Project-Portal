import { test } from "node:test";
import assert from "node:assert/strict";
import { achieved, divergenceNotes, efficiencyOf, latestResults, parseDivergence } from "./results.ts";
import type { BenchmarkRow } from "../study/benchmarks.ts";

const LINE = "DIVERGENCE subgroup=64 lanes=7680000,7542000,3065000 subgroups=120000,120000,120000";

test("the renderer's line parses, and efficiency is lanes over width × subgroups", () => {
  const r = parseDivergence(LINE);
  assert.ok(r.ok);
  const e = efficiencyOf(r.value);
  assert.deepEqual(e.perTrip.map((x) => Math.round(x * 1000) / 1000), [1, 0.982, 0.399]);
  assert.equal(Math.round(e.overall * 1000) / 1000, Math.round(((7680000 + 7542000 + 3065000) / (3 * 120000 * 64)) * 1000) / 1000);
});

test("bad lines say what to fix", () => {
  const cases: [string, RegExp][] = [
    ["lanes=1 subgroups=1", /subgroup=/],
    ["subgroup=48 lanes=1 subgroups=1", /subgroup size/],
    ["subgroup=16 lanes=1,2 subgroups=1", /same count/],
    ["subgroup=16 lanes=40 subgroups=2", /more lanes/],
    ["subgroup=16 lanes=16,32 subgroups=1,2", /More subgroups/],
    ["subgroup=16 lanes=0 subgroups=0", /No subgroups/],
  ];
  for (const [text, message] of cases) {
    const r = parseDivergence(text);
    assert.equal(r.ok, false, text);
    if (!r.ok) assert.match(r.error, message, text);
  }
});

test("stored notes read back to the same counts", () => {
  const r = parseDivergence(LINE);
  assert.ok(r.ok);
  const back = parseDivergence(divergenceNotes(r.value, "1000 frames after 100 warm-up."));
  assert.ok(back.ok);
  assert.deepEqual(back.value, r.value);
});

const row = (over: Partial<BenchmarkRow>): BenchmarkRow => ({
  gid: "1", project: "rendering", task_gid: null, metric: "Frame time", value: "1", unit: "ms",
  scene: "4 spheres (hard-coded), 800x600", gpu: "AMD Radeon RX 5700 XT", commit_sha: "2852489", notes: "", created_at: "2026-11-10T10:00:00Z", ...over,
});

test("the latest frame time per GPU wins, other scenes and GPUs are ignored", () => {
  const rows = [
    row({ value: "0.2", created_at: "2026-11-09T10:00:00Z" }),
    row({ value: "0.1408" }),
    row({ value: "0.05", scene: "BVH bunny, 800x600", metric: "BVH build time" }),
    row({ gpu: "Intel Iris Xe (TGL GT2)", value: "0.8369" }),
    row({ gpu: "llvmpipe", value: "40" }),
    row({ gpu: "AMD Radeon RX 5700 XT", metric: "SIMD efficiency", unit: "%", value: "53", notes: divergenceNotes((parseDivergence(LINE) as { ok: true; value: never }).value) }),
  ];
  const r = latestResults(rows);
  assert.equal(r.rx.dispatch?.ms, 0.1408);
  assert.equal(r.iris.dispatch?.ms, 0.8369);
  assert.equal(r.rx.divergence?.subgroup, 64);
  assert.equal(r.iris.divergence, null);
});

test("achieved rates follow from the dispatch time", () => {
  const a = achieved(0.1408);
  assert.equal(Math.round(a.mpaths), 3409);
  assert.equal(Math.round(a.gbs), 123);
  assert.ok(Math.abs(a.ofRxRoof - 0.27) < 0.01);
});
