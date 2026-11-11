import { test } from "node:test";
import assert from "node:assert/strict";
import { explainPixel, frameStats, pcgHash, randomSequence, runSubgroup, subgroupPixels, tracePixel, workgroupOf } from "./pathtracer.ts";
import { CENTRE, CODE_LINES, CODE_MAP, MODEL, PARTS, RENDERER, VIEWS, allFindings, codeHref, viewsForUnit } from "./guide.ts";
import { findUnit } from "../study/plans.ts";

test("pcgHash matches the shader's, checked against a C build of the same function", () => {
  const expected: [number, number][] = [[0, 129708002], [1, 2831084092], [42, 1223963391], [719393, 1815429807], [4294967295, 3861530882], [480000, 1097323782]];
  for (const [input, output] of expected) assert.equal(pcgHash(input), output);
});

test("pixels map to workgroups and subgroups the way the dispatch lays them out", () => {
  assert.deepEqual(workgroupOf(403, 298), { gx: 50, gy: 37, lx: 3, ly: 2 });
  const lanes = subgroupPixels(403, 298, 16);
  assert.equal(lanes.length, 16);
  assert.deepEqual(lanes[0], { x: 400, y: 298, lane: 0 });
  assert.deepEqual(lanes[15], { x: 407, y: 299, lane: 15 });
  assert.equal(subgroupPixels(403, 298, 64)[63].y, 303);
});

test("a ray straight up escapes on the first trip, and paths stay within the cap", () => {
  const top = tracePixel(400, 0, 800, 600);
  assert.equal(top.iterations, 1);
  assert.equal(top.ended, "sky");
  for (const [x, y] of [[400, 300], [100, 550], [620, 380]]) {
    const p = tracePixel(x, y, 800, 600);
    assert.ok(p.iterations >= 1 && p.iterations <= 8);
    assert.equal(p.ended === "sky" ? p.hits.length + 1 : p.hits.length, p.iterations);
  }
});

test("a subgroup runs as long as its slowest lane, and lanes past the edge do nothing", () => {
  const run = runSubgroup(400, 300, 16, 800, 600);
  assert.equal(run.trips, Math.max(...run.lanes.map((l) => l.path!.iterations)));
  assert.equal(run.perTrip[0].active, 16);
  assert.ok(run.efficiency > 0 && run.efficiency <= 1);
  // A 1003-wide image: the last workgroup column holds 3 real pixels and 5 past the edge.
  const edge = runSubgroup(1000, 0, 8, 1003, 600);
  assert.equal(edge.lanes.filter((l) => l.inside).length, 3);
});

test("the model still gives the numbers the Lab pages quote", () => {
  const s = frameStats(RENDERER.width, RENDERER.height);
  const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
  near(s.meanIterations, MODEL.meanTrips, 0.005);
  near(s.meanHits, MODEL.meanHits, 0.005);
  near(s.histogram[0], MODEL.escapeFirstTrip, 0.001);
  near(s.hitLimit, MODEL.hitLimit, 0.0005);
  near(s.meanUnitTries, MODEL.unitTries, 0.005);
  assert.equal(s.inwardMetal, MODEL.inwardMetal);
  for (const size of [8, 16, 32, 64] as const) near(s.efficiency[size], MODEL.efficiency[size], 0.005);
});

test("every view names real study units, line ranges inside the files, and numbered steps", () => {
  const lines = CODE_LINES;
  for (const v of VIEWS) {
    for (const ref of v.units) assert.ok(findUnit(ref), `${v.id}: unknown unit ${ref}`);
    const refs = [...v.steps.flatMap((s) => s.code ?? []), ...(v.findings ?? []).flatMap((f) => f.code ?? [])];
    for (const [file, from, to] of refs) {
      assert.ok(from >= 1 && from <= lines[file], `${v.id}: ${file}:${from}`);
      if (to !== undefined) assert.ok(to > from && to <= lines[file], `${v.id}: ${file}:${from}-${to}`);
    }
    assert.ok(v.steps.length >= 4 && v.steps.length <= 9, `${v.id}: figures number 1 to 9`);
    assert.ok((v.book.length || v.bookNote) && v.checks.length && v.facts.length, `${v.id}: book, checks and facts`);
    assert.ok(PARTS.some((p) => p.id === v.part), `${v.id}: part`);
  }
  assert.equal(new Set(VIEWS.map((v) => v.id)).size, VIEWS.length);
  assert.match(codeHref(["main", 804]), /\/blob\/355324b446aaee4faee8a283d5be413d508f0fe8\/src\/main\.cpp#L804$/);
  assert.equal(allFindings()[0].kind, "bug");
  assert.ok(viewsForUnit("r-divergence").some((v) => v.id === "divergence"));
});

test("the code map covers every line of the renderer, end to end, and every view owns some code", () => {
  for (const file of ["cmake", "main", "shader"] as const) {
    const ranges = CODE_MAP.filter((c) => c.file === file);
    assert.equal(ranges[0].from, 1, `${file} starts at line 1`);
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].from, ranges[i - 1].to + 1, `${file}: gap or overlap before line ${ranges[i].from}`);
    assert.equal(ranges.at(-1)!.to, CODE_LINES[file], `${file} ends at its last line`);
  }
  for (const c of CODE_MAP) for (const id of c.views) assert.ok(VIEWS.some((v) => v.id === id), `unknown view ${id}`);
  for (const v of VIEWS) assert.ok(CODE_MAP.some((c) => c.views.includes(v.id)), `${v.id} explains no code`);
});

test("the worked examples come from the same code path as the frame statistics", () => {
  for (const [x, y, frame] of [[400, 300, 0], [240, 370, 0], [600, 430, 3], [5, 595, 1]]) {
    const e = explainPixel(x, y, 800, 600, frame);
    assert.deepEqual(e.result, tracePixel(x, y, 800, 600, frame));
    assert.equal(e.trips.length, e.result.iterations);
    assert.deepEqual(e.trips.at(-1)!.color, e.result.color);
  }
  // The centre pixel: only the mirror sphere is hit on the first trip, at t ≈ 1.195.
  const first = CENTRE.trips[0];
  assert.equal(first.hit?.sphere, 0);
  assert.ok(Math.abs(first.hit!.t - 1.1946) < 1e-3);
  assert.deepEqual(first.tests.map((t) => t.disc > 0), [true, false, false, false]);
  // Its jitter is the second and third hash after the pixel index, as in the shader.
  const draws = randomSequence(pcgHash(400 + 300 * 800), 2).map((d) => d.value);
  assert.deepEqual(draws, CENTRE.jitter);
});
