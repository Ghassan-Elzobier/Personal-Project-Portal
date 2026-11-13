import { test } from "node:test";
import assert from "node:assert/strict";
import { AXLER } from "./axler.ts";
import { LINKS, linksFor } from "./links.ts";
import { PMPP } from "./pmpp.ts";
import { RENDERING } from "./rendering.ts";
import { dependents, findUnit, planFor, planPayload, PLANS } from "./plans.ts";
import { planUnits } from "./plan-types.ts";

test("every ref is unique across all plans", () => {
  const refs = PLANS.flatMap((p) => planUnits(p).map((u) => u.ref));
  assert.equal(new Set(refs).size, refs.length);
});

test("every prerequisite names a real unit, and none needs itself", () => {
  for (const plan of PLANS) {
    for (const u of planUnits(plan)) {
      for (const need of u.needs ?? []) {
        assert.ok(findUnit(need), `${u.ref} needs missing ${need}`);
        assert.notEqual(need, u.ref);
      }
    }
  }
});

test("prerequisites never form a loop", () => {
  const visit = (ref: string, path: string[]): void => {
    assert.ok(!path.includes(ref), `loop: ${[...path, ref].join(" -> ")}`);
    for (const n of findUnit(ref)?.unit.needs ?? []) visit(n, [...path, ref]);
  };
  for (const plan of PLANS) for (const u of planUnits(plan)) visit(u.ref, []);
});

test("every unit fits what the database accepts, so loading a plan cannot fail halfway", () => {
  for (const plan of PLANS) {
    for (const section of plan.sections) assert.ok(section.name.length <= 120, section.name);
    for (const u of planUnits(plan)) {
      assert.ok(u.ref.length <= 40, u.ref);
      assert.ok(u.name.length >= 1 && u.name.length <= 500, u.ref);
      assert.ok(u.notes.length <= 20000, u.ref);
      assert.ok((u.exercises ?? 0) <= 1000, u.ref);
      assert.ok(u.steps.length > 0, `${u.ref} has no steps`);
      for (const step of u.steps) assert.ok(step.length <= 300, `${u.ref} step too long: ${step}`);
      for (const r of u.reviews ?? []) assert.ok(r.prompt.length <= 500, `${u.ref} prompt too long: ${r.prompt}`);
      assert.equal(
        new Set((u.reviews ?? []).map((r) => r.prompt)).size,
        (u.reviews ?? []).length,
        `${u.ref} repeats a prompt`,
      );
    }
  }
});

test("Axler has the 4th edition's nine chapters and every section", () => {
  assert.equal(AXLER.sections.length, 9);
  const units = planUnits(AXLER);
  assert.equal(units.length, 35);
  assert.equal(
    units.reduce((sum, u) => sum + (u.exercises ?? 0), 0),
    732,
  );
  assert.equal(units.find((u) => u.ref === "axler-3B")?.page, 59);
  assert.ok(units.find((u) => u.ref === "axler-3B")?.reviews?.some((r) => r.prompt.includes("3.21")));
});

test("Axler's pages rise through the book and open at the right PDF page", () => {
  const pages = planUnits(AXLER).map((u) => u.page!);
  assert.deepEqual(
    pages,
    [...pages].sort((a, b) => a - b),
  );
  assert.equal(AXLER.sourceUrl!(133), "https://linear.axler.net/LADR4e.pdf#page=147");
});

// Read from the book's contents, in chapter order.
const PMPP_CHAPTERS: [number, string, number, number][] = [
  [1, "Introduction", 47, 0],
  [2, "Heterogeneous data-parallel computing", 88, 10],
  [3, "Multidimensional grids and data", 150, 0],
  [4, "Compute architecture and scheduling", 202, 9],
  [5, "Memory architecture and data locality", 264, 12],
  [6, "Performance considerations", 346, 5],
  [7, "Convolution", 404, 11],
  [8, "Stencil computation", 470, 2],
  [9, "Histogram", 522, 5],
  [10, "Reduction", 587, 6],
  [11, "Scan", 677, 7],
  [12, "Filter", 787, 4],
  [13, "Merge", 832, 4],
  [14, "Sorting", 916, 4],
  [15, "Advanced optimizations for matrix multiplication", 971, 3],
  [16, "Dynamic programming and wavefront parallelism", 1043, 6],
  [17, "Sparse matrix computation", 1135, 5],
  [18, "Graph traversal", 1205, 3],
  [19, "Convolutional neural networks", 1294, 4],
  [20, "Large language models", 1362, 4],
  [21, "Electrostatic potential map", 1475, 5],
  [22, "Algorithm selection, problem decomposition, and problem formulation", 1528, 0],
  [23, "Multi-GPU programming", 1556, 3],
  [24, "Conclusion and future outlook", 1668, 0],
];

test("PMPP has the 5th edition's 24 chapters, each with its title, page and exercises", () => {
  const units = planUnits(PMPP);
  const chapters = units.filter((u) => /^pmpp-\d+$/.test(u.ref));
  assert.equal(chapters.length, 24);
  for (const [n, title, page, exercises] of PMPP_CHAPTERS) {
    const u = units.find((x) => x.ref === `pmpp-${n}`);
    assert.ok(u, `missing chapter ${n}`);
    assert.equal(u.name, `Ch ${n} ${title}`);
    assert.equal(u.page, page);
    assert.equal(u.exercises ?? 0, exercises, `chapter ${n}`);
    assert.ok((u.reviews ?? []).length > 0, `chapter ${n} has nothing to recall`);
  }
  assert.equal(
    units.reduce((sum, u) => sum + (u.exercises ?? 0), 0),
    117,
  );
});

test("PMPP's main path follows the book, apart from the part it says it reorders", () => {
  const core = planUnits(PMPP)
    .filter((u) => !u.optional)
    .map((u) => u.ref);
  assert.deepEqual(core, [
    "pmpp-setup",
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => `pmpp-${n}`),
    "pmpp-17",
    "pmpp-18",
    "pmpp-21",
    "pmpp-22",
    "pmpp-app-b",
    "pmpp-19",
    "pmpp-24",
  ]);
});

test("the chapters the renderer depends on are the right ones in this edition", () => {
  const needs = (ref: string) => findUnit(ref)!.unit.needs ?? [];
  assert.ok(needs("r-gpu-sort").includes("pmpp-14"), "radix sort is Chapter 14");
  assert.ok(needs("r-gpu-sort").includes("pmpp-11"), "scan is Chapter 11");
  assert.ok(needs("r-gpu-sort").includes("pmpp-12"), "filter is Chapter 12");
  assert.ok(needs("r-nerf-paper").includes("pmpp-19"), "CNNs are Chapter 19");
  assert.ok(needs("r-wavefront").includes("pmpp-18"), "graph traversal is Chapter 18");
  assert.ok(needs("r-gs-raster").includes("pmpp-21"), "scatter and gather are Chapter 21");
});

test("the renderer's order puts measuring first and needs earlier units before later ones", () => {
  const units = planUnits(RENDERING);
  assert.equal(units[0].ref, "r-baseline");
  const position = new Map(units.map((u, i) => [u.ref, i]));
  for (const u of units) {
    for (const need of u.needs ?? []) {
      if (position.has(need)) assert.ok(position.get(need)! < position.get(u.ref)!, `${u.ref} comes before ${need}`);
    }
  }
});

test("a chapter's prerequisites come before it in the plan", () => {
  const units = planUnits(PMPP);
  const position = new Map(units.map((u, i) => [u.ref, i]));
  for (const u of units) {
    for (const need of u.needs ?? []) {
      if (position.has(need)) assert.ok(position.get(need)! < position.get(u.ref)!, `${u.ref} comes before ${need}`);
    }
  }
});

test("dependents links a book chapter to the milestones it feeds", () => {
  const refs = dependents("pmpp-14").map((d) => d.unit.ref);
  assert.ok(refs.includes("r-gpu-sort"));
  assert.ok(dependents("axler-7B").some((d) => d.unit.ref === "r-gs-raster"));
});

test("every link joins two real units in different plans, once, with a reason", () => {
  const seen = new Set<string>();
  for (const l of LINKS) {
    const a = findUnit(l.a);
    const b = findUnit(l.b);
    assert.ok(a, `no unit ${l.a}`);
    assert.ok(b, `no unit ${l.b}`);
    assert.notEqual(a.plan.project, b.plan.project, `${l.a} and ${l.b} are in one plan`);
    assert.ok(l.why.length > 20 && l.why.length <= 400, `${l.a} to ${l.b}: reason is ${l.why.length} characters`);
    const key = [l.a, l.b].sort().join(" ");
    assert.ok(!seen.has(key), `repeated link: ${key}`);
    seen.add(key);
  }
});

test("every core PMPP chapter with a build connects to something outside the book", () => {
  const skip = new Set(["pmpp-setup", "pmpp-1", "pmpp-24"]);
  for (const u of planUnits(PMPP)) {
    if (u.optional || skip.has(u.ref)) continue;
    const links = linksFor(u.ref);
    const feeds = dependents(u.ref).filter((d) => d.plan !== PMPP);
    assert.ok(links.length + feeds.length > 0, `${u.ref} connects to nothing`);
  }
});

test("linksFor gives the other end from either side", () => {
  assert.ok(linksFor("pmpp-14").some((l) => l.ref === "r-gpu-sort"));
  assert.ok(linksFor("r-gpu-sort").some((l) => l.ref === "pmpp-14"));
  assert.deepEqual(linksFor("no-such-unit"), []);
});

test("the import payload carries steps, reviews and exercise counts", () => {
  const tasks = planPayload(AXLER).flatMap((s) => s.tasks);
  const b3 = tasks.find((t) => t.ref === "axler-3B")!;
  assert.equal(b3.exercise_count, 33);
  assert.equal(b3.subtasks.length, 4);
  assert.ok(b3.reviews.length >= 1);
  assert.equal(
    planPayload(RENDERING)
      .flatMap((s) => s.tasks)
      .find((t) => t.ref === "r-gs-paper")!.exercise_count,
    null,
  );
  assert.equal(
    planPayload(PMPP)
      .flatMap((s) => s.tasks)
      .find((t) => t.ref === "pmpp-11")!.exercise_count,
    7,
  );
});

test("planFor finds plans by project", () => {
  assert.equal(planFor("rendering")?.mode, "lab");
  assert.equal(planFor("weekly-log"), undefined);
});
