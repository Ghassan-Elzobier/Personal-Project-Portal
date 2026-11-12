import { test } from "node:test";
import assert from "node:assert/strict";
import { lifeBlocks } from "./life-plan.ts";
import { buildState, type LifeRaw } from "../life/state.ts";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import type { Block } from "./schedule.ts";

// Gym Tue, Thu, Sat at 06:45; cook Saturday 17:00. The meal week starts Saturday 14th.
const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  gym: { ...DEFAULT_PROFILE.gym, days: [1, 3, 5], start: 405, minutes: 65 },
  routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 1020 }] },
};
const raw: LifeRaw = {
  profile,
  weights: [],
  plans: [],
  meals: [],
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
};
const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const study = (date: string, start: number, end: number, title = "PMPP 4.5"): Block => ({ id: `t-${date}-${start}`, source: "asana", title, date, start, end, url: "", editable: true });
const lifeBlock = (date: string, start: number, end: number, kind: string, title: string): Block => ({ id: `g-${date}-${start}`, source: "google", title, date, start, end, url: "", editable: true, kind });

test("the plan shows from this meal week on, and earlier days stay empty", () => {
  const s = buildState(raw, "2026-11-14");
  const { blocks } = lifeBlocks(s, week, []);
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((b) => b.date >= "2026-11-14" && b.source === "plan" && !b.editable));
});

test("study pushes lunch along, and the block says why", () => {
  const s = buildState(raw, "2026-11-14");
  const lunch = s.profile.routine.lunch;
  const { blocks } = lifeBlocks(s, week, [study("2026-11-15", lunch - 30, lunch + 60)]);
  const b = blocks.find((x) => x.id === "plan-2026-11-15:meal:lunch")!;
  assert.ok(b.start >= lunch + 60 || b.end <= lunch - 30, `lunch at ${b.start}`);
  assert.match(b.note!, /PMPP 4\.5/);
  assert.equal(b.clash, false);
});

test("a life block you added for the same thing stands in for the plan's, and still holds its time", () => {
  const s = buildState(raw, "2026-11-14");
  const others = [lifeBlock("2026-11-14", 400, 470, "gym", "Gym"), lifeBlock("2026-11-15", s.profile.routine.breakfast - 15, s.profile.routine.breakfast, "other", "Weigh in")];
  const { blocks } = lifeBlocks(s, week, others);
  assert.ok(!blocks.some((b) => b.id === "plan-2026-11-14:gym"), "your Gym block stands in");
  assert.ok(!blocks.some((b) => b.id === "plan-2026-11-15:weigh"), "same name stands in");
  // Something different at the same time does not stand in: the plan's item moves instead.
  const dentist = lifeBlocks(s, week, [lifeBlock("2026-11-15", 11 * 60, 15 * 60, "other", "Dentist")]).blocks;
  assert.ok(dentist.some((b) => b.id === "plan-2026-11-15:meal:lunch"));
});

test("nothing before the profile is set up", () => {
  const s = buildState({ ...raw, profile: DEFAULT_PROFILE }, "2026-11-14");
  assert.deepEqual(lifeBlocks(s, week, []).blocks, []);
});
