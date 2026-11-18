import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, reminders, sizeCooks, spare } from "./planner.ts";
import { DEFAULT_PROFILE, plannerRoutine, type LifeProfile } from "./profile.ts";
import { recipe } from "./recipes.ts";
import { suggestWeek } from "./suggest.ts";

// Sunday 15 Nov 2026 starts the meal week (the default batch routine cooks on Sundays first).
const START = "2026-11-15";
const KCAL = 2900;

function freshWeek(profile: LifeProfile = DEFAULT_PROFILE, today = START) {
  const plan = suggestWeek(profile, START, [], {}, {}, today, "fresh");
  const routine = plannerRoutine(profile);
  const sized = { ...plan, cooks: sizeCooks(plan, routine, KCAL) };
  return { plan: sized, placed: assign(sized, routine, [], KCAL) };
}

test("a fresh week has one dish per session, each within the session's time", () => {
  const { plan } = freshWeek();
  assert.equal(plan.mode, "fresh");
  assert.deepEqual(
    plan.cooks.map((c) => c.date),
    ["2026-11-15", "2026-11-16", "2026-11-18", "2026-11-20"],
  );
  for (const c of plan.cooks) {
    const r = recipe(c.recipe)!;
    assert.equal(r.meal, "main", `${c.recipe} is the session's one dish`);
    assert.ok(r.totalMin <= 45, `${c.recipe} takes ${r.totalMin} minutes`);
  }
  assert.equal(new Set(plan.cooks.map((c) => c.recipe)).size, plan.cooks.length);
});

test("a fresh week freezes nothing, and every lunch and dinner after the first cook is fed", () => {
  const { plan, placed } = freshWeek();
  assert.deepEqual(
    placed.filter((p) => p.storage === "freezer").map((p) => p.id),
    [],
  );
  assert.deepEqual(
    reminders(plan, placed).filter((r) => r.kind === "freeze" || r.kind === "defrost"),
    [],
  );
  const firstReady = plan.cooks[0];
  const unfed = placed.filter(
    (p) => (p.slot === "lunch" || p.slot === "dinner") && p.source === "none" && p.date > firstReady.date,
  );
  assert.deepEqual(
    unfed.map((p) => p.id),
    [],
  );
  // The last cook makes next Sunday's lunch too, and it is still in date then.
  assert.ok(spare(plan, placed).length <= 1);
});

test("a fresh week's shops are the routine's trips, and no batch breakfast is cooked", () => {
  const { plan } = freshWeek();
  assert.deepEqual(
    plan.trips?.map((t) => [t.date, t.start]),
    [
      ["2026-11-15", 600],
      ["2026-11-18", 1035],
    ],
  );
  assert.ok(plan.cooks.every((c) => recipe(c.recipe)?.meal !== "breakfast"));
  assert.ok(recipe(plan.breakfast)?.meal === "breakfast");
});

test("planned late, the gone sessions and shops become one catch-up of each today", () => {
  const { plan } = freshWeek(DEFAULT_PROFILE, "2026-11-17");
  assert.deepEqual(
    plan.cooks.map((c) => c.date),
    ["2026-11-17", "2026-11-18", "2026-11-20"],
  );
  assert.deepEqual(
    plan.trips?.map((t) => t.date),
    ["2026-11-17", "2026-11-18"],
  );
});

test("with no dish short enough, a session still gets the quickest one", () => {
  const tight: LifeProfile = {
    ...DEFAULT_PROFILE,
    routine: {
      ...DEFAULT_PROFILE.routine,
      fresh: { ...DEFAULT_PROFILE.routine.fresh, cooks: [{ weekday: 6, start: 1080, minutes: 15 }] },
    },
  };
  const { plan } = freshWeek(tight);
  assert.equal(plan.cooks.length, 1);
  assert.ok(recipe(plan.cooks[0].recipe)!.totalMin <= 30);
});

test("a batch week is planned as before", () => {
  const plan = suggestWeek(DEFAULT_PROFILE, START, [], {}, {}, START);
  assert.equal(plan.mode, undefined);
  assert.equal(plan.trips, undefined);
  // Two sessions, two mains each, and a breakfast batch on the first.
  assert.equal(plan.cooks.filter((c) => recipe(c.recipe)?.meal === "main").length, 4);
});
