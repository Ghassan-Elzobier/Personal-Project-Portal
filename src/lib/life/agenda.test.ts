import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, lifeAgenda, type AgendaItem } from "./agenda.ts";
import { buildState, type LifeRaw } from "./state.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";

// Gym Tue, Thu, Sat at 06:45 for 65 minutes; cook Sat 17:00 and Wed 18:30.
const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  gym: { ...DEFAULT_PROFILE.gym, days: [1, 3, 5], start: 405, minutes: 65 },
  routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 1020 }, { weekday: 2, start: 1110 }] },
};
const plan0: WeekPlan = {
  start: "2026-11-14",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-14", start: 1020, portions: 0, scale: 1 },
    { id: "b", recipe: "butter-chicken", date: "2026-11-14", start: 1020, portions: 0, scale: 1 },
    { id: "c", recipe: "cottage-pie", date: "2026-11-18", start: 1110, portions: 0, scale: 1 },
  ],
  breakfast: "porridge",
  shake: "vanilla-shake",
  fresh: [],
  out: [],
};
const routine = { ...profile.routine, gymDays: profile.gym.days, gymEnd: 405 + 65 };
const raw: LifeRaw = {
  profile,
  weights: [],
  plans: [{ start: "2026-11-14", data: { ...plan0, cooks: sizeCooks(plan0, routine as never, 2700) } }],
  meals: [],
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
};
const days = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"];
const at = (items: AgendaItem[], key: string) => items.find((i) => i.key === key)!;

test("the agenda comes from the plans: recipes on meals, the rotation on gym days, cooks with what they cook", () => {
  const s = buildState(raw, "2026-11-14");
  const items = lifeAgenda(s, days);
  assert.match(at(items, "2026-11-14:gym").title, /^Gym: A,/);
  assert.match(at(items, "2026-11-17:gym").title, /^Gym: B,/);
  assert.ok(!items.some((i) => i.key === "2026-11-15:gym"), "Sunday is a rest day");
  assert.match(at(items, "2026-11-14:cook:1020").title, /Spaghetti bolognese, Butter chicken/);
  assert.match(at(items, "2026-11-15:meal:lunch").title, /^Lunch: /);
  assert.match(at(items, "2026-11-16:meal:breakfast").title, /Warm protein porridge/);
  // On gym days the shake follows training.
  assert.equal(at(items, "2026-11-17:meal:shake").preferred, 405 + 65 + 10);
});

test("a clash moves the life item to the nearest free time in its window, and fixed time never moves", () => {
  const s = buildState(raw, "2026-11-14");
  const items = lifeAgenda(s, days);
  const busy = [
    { date: "2026-11-17", start: 18 * 60, end: 21 * 60, title: "Study: Ch 4" },
    { date: "2026-11-16", start: 12 * 60, end: 13 * 60, title: "1:1" },
    { date: "2026-11-16", start: 13 * 60, end: 14 * 60, title: "Study block" },
  ];
  const out = arrange(items, busy);
  // Dinner before evening study.
  assert.equal(at(out, "2026-11-17:meal:dinner").start, 17 * 60 + 30);
  assert.match(at(out, "2026-11-17:meal:dinner").moved!, /Study: Ch 4/);
  // Lunch around a 12:00 meeting and 13:00 study.
  assert.equal(at(out, "2026-11-16:meal:lunch").start, 11 * 60 + 30);
  // Wednesday dinner doesn't overlap the cook (it comes from the earlier batch, so before is fine).
  const cook = at(out, "2026-11-18:cook:1110");
  const dinner = at(out, "2026-11-18:meal:dinner");
  assert.ok(dinner.start + dinner.duration <= cook.start || dinner.start >= cook.start + cook.duration, `dinner ${dinner.start} cook ${cook.start}`);
  // Nothing life-side overlaps anything else on any day.
  for (const d of days) {
    const list = out.filter((i) => i.date === d && !i.clash);
    for (const a of list) for (const b of list) if (a !== b) assert.ok(a.start + a.duration <= b.start || b.start + b.duration <= a.start, `${a.key} overlaps ${b.key}`);
  }
});

test("with nowhere to go, an item stays and says what it clashes with", () => {
  const s = buildState(raw, "2026-11-14");
  const items = lifeAgenda(s, ["2026-11-16"]);
  const out = arrange(items, [{ date: "2026-11-16", start: 11 * 60, end: 15 * 60, title: "Offsite" }]);
  const lunch = at(out, "2026-11-16:meal:lunch");
  assert.equal(lunch.start, 12 * 60 + 30);
  assert.match(lunch.clash!, /Offsite/);
});

test("the rotation carries on from today: a missed day is not counted as trained, and next week follows this one", () => {
  // Today is Thursday 19th; Saturday's A was done, Tuesday was missed.
  const s = buildState({ ...raw, sessions: [{ day: "2026-11-14", workout: "A", finished: true, feel: null, notes: "" }] }, "2026-11-19");
  const items = lifeAgenda(s, ["2026-11-17", "2026-11-19", "2026-11-21", "2026-11-24"]);
  assert.match(at(items, "2026-11-17:gym").title, /^Gym: B,/, "Tuesday was due B");
  assert.match(at(items, "2026-11-19:gym").title, /^Gym: B,/, "B carries over to today");
  assert.match(at(items, "2026-11-21:gym").title, /^Gym: C,/);
  assert.match(at(items, "2026-11-24:gym").title, /^Gym: A,/, "next week follows on");
});
