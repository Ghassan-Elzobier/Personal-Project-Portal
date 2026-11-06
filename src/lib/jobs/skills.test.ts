import assert from "node:assert/strict";
import test from "node:test";
import { findUnit } from "../study/plans.ts";
import { BRANCHES, findSkills, skillByKey, SKILLS } from "./skills.ts";

const keys = (text: string) => findSkills(text).map((s) => s.skill.key);

test("every skill has a unique key the database accepts", () => {
  const seen = new Set<string>();
  for (const s of SKILLS) {
    assert.match(s.key, /^[a-z0-9-]{1,40}$/);
    assert.ok(!seen.has(s.key), s.key);
    seen.add(s.key);
  }
});

test("every unit a skill names is a real unit", () => {
  for (const s of SKILLS) for (const ref of s.taughtBy ?? []) assert.ok(findUnit(ref), `${s.key} names ${ref}`);
});

test("related skills and branches name real skills", () => {
  for (const s of SKILLS) for (const k of s.near ?? []) assert.ok(skillByKey(k), `${s.key} near ${k}`);
  for (const b of BRANCHES) for (const k of b.skills) assert.ok(skillByKey(k), `${b.key} has ${k}`);
});

test("names with punctuation are found", () => {
  assert.ok(keys("Advanced C++17 and C#").includes("cpp"));
  assert.ok(keys("Advanced C++17 and C#").includes("csharp"));
  assert.ok(keys("DirectX 12, D3D12 or DX12").includes("d3d12"));
  assert.ok(keys("UE5").includes("unreal"));
});

test("words that merely contain or resemble a skill are not it", () => {
  assert.ok(!keys("Barracuda networks").includes("cuda"));
  assert.ok(!keys("cuda fish").includes("cuda"));
  assert.ok(!keys("sheet metal fabrication").includes("metal"));
  assert.ok(!keys("Sheet Metal fabrication").includes("metal"));
  assert.ok(!keys("a sense of community and unity").includes("unity"));
  assert.ok(!keys("We trust people and rust never sleeps").includes("rust"));
  assert.ok(!keys("We react quickly to change").includes("react"));
  assert.ok(!keys("power transformers in substations").includes("transformers"));
  assert.ok(!keys("We go and do it").includes("go"));
  assert.ok(!keys("the GPU cluster team").includes("gpu-programming"));
});

test("the skills most likely to decide a role are found in ordinary wording", () => {
  assert.ok(keys("Deep understanding of real-time rendering").includes("real-time-rendering"));
  assert.ok(keys("BVH traversal on the GPU").includes("bvh"));
  assert.ok(keys("3D Gaussian Splatting").includes("gaussian-splatting"));
  assert.ok(keys("multi-threaded programming").includes("multithreading"));
  assert.ok(keys("Vulkan compute shaders").includes("compute-shaders"));
  assert.ok(keys("PyTorch model training").includes("model-training"));
});
