import assert from "node:assert/strict";
import test from "node:test";
import type { Roadmap, RoadmapPhase, RoadmapUnit } from "./load.ts";
import { recallSummary, shareRoadmap } from "./shared-roadmap.ts";

const unit = (ref: string, over: Partial<RoadmapUnit> = {}): RoadmapUnit => ({
  ref,
  name: ref,
  short: ref,
  href: `/study?task=${ref}`,
  done: false,
  optional: false,
  hours: 5,
  ...over,
});
const phase = (index: number, tracks: RoadmapPhase["tracks"], links: RoadmapPhase["links"] = []): RoadmapPhase => ({
  phase: {
    name: `Phase ${index + 1}`,
    why: "why",
    exit: "exit",
    units: tracks.flatMap((t) => t.units.map((u) => u.ref)),
  },
  index,
  state: "later",
  tracks,
  links,
  done: 0,
  total: 0,
  hoursLeft: 0,
});

const roadmap: Roadmap = {
  phases: [
    phase(
      0,
      [
        { project: "pmpp", title: "PMPP 5e", units: [unit("pmpp-1", { done: true }), unit("pmpp-2")] },
        { project: "axler", title: "Axler LADR", units: [unit("axler-1A", { done: true })] },
        {
          project: "rendering",
          title: "Rendering lab",
          units: [unit("r-baseline"), unit("r-materials", { optional: true })],
        },
      ],
      [
        { a: "pmpp-2", b: "r-harness", why: "renderer link", aShort: "Ch 2", bShort: "Harness" },
        { a: "pmpp-2", b: "axler-1A", why: "maths link", aShort: "Ch 2", bShort: "1A" },
      ],
    ),
    phase(1, [{ project: "rendering", title: "Rendering lab", units: [unit("r-camera")] }]),
  ],
  current: null,
  missing: 0,
  hoursLeft: 0,
  dated: 0,
  remaining: 0,
};

const dueOn = new Map<string, string | null>([
  ["pmpp-2", "2026-11-01"],
  ["r-baseline", "2026-12-01"],
  ["r-camera", "2027-01-10"],
]);

test("a mentor sees only the plans shared with them", () => {
  const shared = shareRoadmap(roadmap, { projects: ["pmpp", "axler"], dueOn, today: "2026-11-06" });
  assert.deepEqual(
    shared.phases.map((p) => p.tracks.map((t) => t.project)),
    [["pmpp", "axler"]],
  );
  assert.equal(shared.phases.length, 1, "a phase with nothing shared in it is left out");
});

test("progress is counted over the shared plans alone, without optional units", () => {
  const shared = shareRoadmap(roadmap, { projects: ["pmpp", "axler"], dueOn, today: "2026-11-06" });
  assert.deepEqual([shared.done, shared.total, shared.hoursLeft], [2, 3, 5]);
  const all = shareRoadmap(roadmap, { projects: ["pmpp", "axler", "rendering"], dueOn, today: "2026-11-06" });
  assert.deepEqual([all.done, all.total], [2, 5], "r-materials is optional and not counted");
});

test("links show only when both ends are shared", () => {
  const shared = shareRoadmap(roadmap, { projects: ["pmpp", "axler"], dueOn, today: "2026-11-06" });
  assert.deepEqual(
    shared.phases[0].links.map((l) => l.why),
    ["maths link"],
  );
});

test("units past their date are overdue, and the finish date is the last one due", () => {
  const all = shareRoadmap(roadmap, { projects: ["pmpp", "axler", "rendering"], dueOn, today: "2026-11-06" });
  assert.deepEqual(
    all.overdue.map((u) => u.ref),
    ["pmpp-2"],
  );
  assert.equal(all.finishOn, "2027-01-10");
  assert.equal(all.current?.index, 0);
});

test("with any undated unit there is no finish date, only a count of undated units", () => {
  const partial = shareRoadmap(roadmap, {
    projects: ["pmpp", "axler", "rendering"],
    dueOn: new Map([["pmpp-2", "2026-12-01"]]),
    today: "2026-11-06",
  });
  assert.equal(partial.finishOn, null);
  assert.equal(partial.undated, 2);
});

test("phases finish in order, and the first unfinished one is now", () => {
  const done = shareRoadmap(
    {
      ...roadmap,
      phases: [
        phase(0, [{ project: "axler", title: "Axler", units: [unit("axler-1A", { done: true })] }]),
        roadmap.phases[0],
      ],
    },
    { projects: ["axler", "pmpp"], dueOn, today: "2026-11-06" },
  );
  assert.deepEqual(
    done.phases.map((p) => p.state),
    ["done", "now"],
  );
});

test("recall counts only the last two weeks", () => {
  const summary = recallSummary(
    [
      { last_rating: "got", last_reviewed_at: "2026-11-05T10:00:00Z" },
      { last_rating: "missed", last_reviewed_at: "2026-10-24T10:00:00Z" },
      { last_rating: "shaky", last_reviewed_at: "2026-10-01T10:00:00Z" },
      { last_rating: null, last_reviewed_at: null },
    ],
    "2026-11-06",
  );
  assert.deepEqual(summary, { days: 14, reviewed: 2, got: 1, shaky: 0, missed: 1 });
});
