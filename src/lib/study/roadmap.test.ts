import { test } from "node:test";
import assert from "node:assert/strict";
import { LINKS } from "./links.ts";
import { findUnit, PLANS } from "./plans.ts";
import { planUnits, unitHours } from "./plan-types.ts";
import { dayAfterHours, weeksFor } from "./pace.ts";
import { linksAt, phaseOf, PHASES, scheduleRoadmap } from "./roadmap.ts";

const nothingDone = () => false;

test("every unit in every plan sits in exactly one phase", () => {
  const placed = PHASES.flatMap((p) => p.units);
  assert.equal(new Set(placed).size, placed.length, "a unit is in two phases");
  for (const ref of placed) assert.ok(findUnit(ref), `no unit ${ref}`);
  for (const plan of PLANS) {
    for (const u of planUnits(plan)) assert.ok(placed.includes(u.ref), `${u.ref} is in no phase`);
  }
});

test("nothing is scheduled before what it needs", () => {
  for (const plan of PLANS) {
    for (const u of planUnits(plan)) {
      for (const need of u.needs ?? []) {
        assert.ok(
          phaseOf(need) <= phaseOf(u.ref),
          `${u.ref} (phase ${phaseOf(u.ref)}) needs ${need} (phase ${phaseOf(need)})`,
        );
      }
    }
  }
});

test("each plan's main path runs in its own order, so next up agrees with the roadmap", () => {
  for (const plan of PLANS) {
    const phases = planUnits(plan)
      .filter((u) => !u.optional)
      .map((u) => phaseOf(u.ref));
    assert.deepEqual(
      phases,
      [...phases].sort((a, b) => a - b),
      plan.project,
    );
  }
});

test("every phase has all three plans in it, with a reason and an end", () => {
  for (const phase of PHASES) {
    const plans = new Set(phase.units.map((ref) => findUnit(ref)!.plan.project));
    assert.deepEqual([...plans].sort(), ["axler", "pmpp", "rendering"], phase.name);
    assert.ok(phase.why.length > 0 && phase.exit.length > 0, phase.name);
  }
});

test("each link shows once, at the phase where its later end arrives", () => {
  const shown = PHASES.flatMap((_, i) => linksAt(i));
  assert.equal(shown.length, LINKS.length);
  assert.ok(linksAt(phaseOf("r-gs-raster")).some((l) => l.a === "axler-7B" && l.b === "r-gs-raster"));
  assert.ok(
    linksAt(phaseOf("axler-9C")).some((l) => l.b === "r-triangles"),
    "a far-off link waits for its later end",
  );
});

test("the schedule covers the main path, leaving out optional units", () => {
  const dated = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-09", hoursPerWeek: 12 });
  const refs = dated.map((d) => d.ref);
  const core = PLANS.flatMap((p) =>
    planUnits(p)
      .filter((u) => !u.optional)
      .map((u) => u.ref),
  );
  assert.deepEqual([...refs].sort(), [...core].sort());
  assert.ok(!refs.includes("pmpp-16"));
});

test("dates only move forward, and phases do not overlap", () => {
  const dated = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-09", hoursPerWeek: 12 });
  const dates = dated.map((d) => d.dueOn);
  assert.deepEqual(dates, [...dates].sort());
  const phases = dated.map((d) => phaseOf(d.ref));
  assert.deepEqual(
    phases,
    [...phases].sort((a, b) => a - b),
  );
});

test("inside a phase, the three plans are woven together, each in its own order", () => {
  const dated = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-09", hoursPerWeek: 12 });
  for (const plan of PLANS) {
    const own = planUnits(plan)
      .filter((u) => !u.optional)
      .map((u) => u.ref);
    assert.deepEqual(
      dated.filter((d) => own.includes(d.ref)).map((d) => d.ref),
      own,
      plan.project,
    );
  }
  const first = dated
    .filter((d) => phaseOf(d.ref) === 1)
    .slice(0, 6)
    .map((d) => findUnit(d.ref)!.plan.project);
  assert.ok(new Set(first).size > 1, `phase runs one plan at a time: ${first.join(", ")}`);
});

test("nothing falls due before something it needs, wherever you have got to", () => {
  const firstHalf = new Set(
    PHASES.slice(0, 3)
      .flatMap((p) => p.units)
      .filter((_, i) => i % 2 === 0),
  );
  for (const isDone of [nothingDone, (ref: string) => firstHalf.has(ref)]) {
    const dated = scheduleRoadmap({ isDone, start: "2026-11-09", hoursPerWeek: 12 });
    const position = new Map(dated.map((d, i) => [d.ref, i]));
    for (const d of dated) {
      for (const need of findUnit(d.ref)!.unit.needs ?? []) {
        if (position.has(need))
          assert.ok(position.get(need)! < position.get(d.ref)!, `${d.ref} falls due before ${need}`);
      }
    }
  }
});

test("the compute harness comes after the chapter it ports, and the roofline lab after Chapter 5", () => {
  const dated = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-09", hoursPerWeek: 12 });
  const at = (ref: string) => dated.findIndex((d) => d.ref === ref);
  assert.ok(at("pmpp-2") < at("r-harness"));
  assert.ok(at("pmpp-5") < at("r-machine"));
  assert.ok(at("pmpp-14") < at("r-gpu-sort"));
  assert.ok(at("axler-7E") < at("r-gs-raster"));
});

test("the last date matches the total hours at the chosen pace", () => {
  const dated = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-02", hoursPerWeek: 10 });
  const hours = dated.reduce((sum, d) => {
    const found = findUnit(d.ref)!;
    return sum + unitHours(found.unit, found.plan);
  }, 0);
  const days = Math.ceil((hours * 7) / 10) - 1;
  const expected = new Date(Date.UTC(2026, 10, 2 + days)).toISOString().slice(0, 10);
  assert.equal(dated.at(-1)!.dueOn, expected);
});

test("finished units are skipped, and the rest close up", () => {
  const all = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-09", hoursPerWeek: 12 });
  const later = scheduleRoadmap({
    isDone: (ref) => ref === "pmpp-setup" || ref === "axler-1A",
    start: "2026-11-09",
    hoursPerWeek: 12,
  });
  assert.equal(later.length, all.length - 2);
  assert.ok(!later.some((d) => d.ref === "pmpp-setup"));
  assert.ok(later.at(-1)!.dueOn < all.at(-1)!.dueOn);
});

test("the whole path takes a believable amount of work", () => {
  const hours = PLANS.flatMap((p) =>
    planUnits(p)
      .filter((u) => !u.optional)
      .map((u) => unitHours(u, p)),
  ).reduce((a, b) => a + b, 0);
  assert.ok(hours > 300 && hours < 700, `${hours} hours`);
});

test("a change of pace moves everything after it", () => {
  const pace = { hoursPerWeek: 40, until: "2026-12-01", thenHoursPerWeek: 18 };
  assert.equal(dayAfterHours("2026-11-06", 40, pace), "2026-11-12", "one week at the first pace");
  // 25 days at 40 a week is about 142.9 hours, so 160 hours run about a week past the change.
  assert.equal(dayAfterHours("2026-11-06", 160, pace), "2026-12-07");
});

test("no change of pace, or one already past, leaves a single pace", () => {
  assert.equal(dayAfterHours("2026-11-06", 40, { hoursPerWeek: 40 }), "2026-11-12");
  assert.equal(
    dayAfterHours("2026-11-06", 40, { hoursPerWeek: 40, until: "2026-11-01", thenHoursPerWeek: 5 }),
    "2026-11-12",
  );
});

test("the roadmap uses both paces and still puts nothing before what it needs", () => {
  const steady = scheduleRoadmap({ isDone: nothingDone, start: "2026-11-06", hoursPerWeek: 40 });
  const changing = scheduleRoadmap({
    isDone: nothingDone,
    start: "2026-11-06",
    hoursPerWeek: 40,
    until: "2026-12-01",
    thenHoursPerWeek: 18,
  });
  assert.deepEqual(
    changing.map((d) => d.ref),
    steady.map((d) => d.ref),
    "the order does not depend on the pace",
  );
  assert.equal(changing[0].dueOn, steady[0].dueOn, "early units are unaffected");
  assert.ok(changing.at(-1)!.dueOn > steady.at(-1)!.dueOn, "the finish moves out");
});

test("the weeks shown under the form match the finish date", () => {
  assert.equal(weeksFor("2026-11-06", 40, { hoursPerWeek: 40 }), 1);
  assert.equal(weeksFor("2026-11-06", 400, { hoursPerWeek: 40 }), 10);
});
