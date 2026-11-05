import { test } from "node:test";
import assert from "node:assert/strict";
import { AXLER } from "./axler.ts";
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

test("Axler has the 4th edition's nine chapters and every section", () => {
  assert.equal(AXLER.sections.length, 9);
  const units = planUnits(AXLER);
  assert.equal(units.length, 35);
  assert.equal(units.reduce((sum, u) => sum + (u.exercises ?? 0), 0), 732);
  assert.equal(units.find((u) => u.ref === "axler-3B")?.page, 59);
  assert.ok(units.find((u) => u.ref === "axler-3B")?.reviews?.some((r) => r.prompt.includes("3.21")));
});

test("Axler's pages rise through the book and open at the right PDF page", () => {
  const pages = planUnits(AXLER).map((u) => u.page!);
  assert.deepEqual(pages, [...pages].sort((a, b) => a - b));
  assert.equal(AXLER.sourceUrl!(133), "https://linear.axler.net/LADR4e.pdf#page=147");
});

test("PMPP lists the 5th edition's 25 chapters in order", () => {
  const chapters = planUnits(PMPP).filter((u) => /^pmpp-\d+$/.test(u.ref));
  assert.equal(chapters.length, 25);
  assert.deepEqual(chapters.map((u) => u.ref), Array.from({ length: 25 }, (_, i) => `pmpp-${i + 1}`));
  assert.equal(chapters[12].name, "Ch 13 Sorting");
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

test("dependents links a book chapter to the milestones it feeds", () => {
  const refs = dependents("pmpp-13").map((d) => d.unit.ref);
  assert.ok(refs.includes("r-gpu-sort"));
  assert.ok(dependents("axler-7B").some((d) => d.unit.ref === "r-gs-raster"));
});

test("the import payload carries steps, reviews and exercise counts", () => {
  const tasks = planPayload(AXLER).flatMap((s) => s.tasks);
  const b3 = tasks.find((t) => t.ref === "axler-3B")!;
  assert.equal(b3.exercise_count, 33);
  assert.equal(b3.subtasks.length, 4);
  assert.ok(b3.reviews.length >= 1);
  assert.equal(planPayload(RENDERING).flatMap((s) => s.tasks).find((t) => t.ref === "r-gs-paper")!.exercise_count, null);
});

test("planFor finds plans by project", () => {
  assert.equal(planFor("rendering")?.mode, "lab");
  assert.equal(planFor("weekly-log"), undefined);
});
