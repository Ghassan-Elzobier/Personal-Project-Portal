import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay } from "./day.ts";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import { sizeCooks, type WeekPlan } from "../life/planner.ts";
import { buildState, type LifeRaw } from "../life/state.ts";

// Today says next week is planned on the day it planned itself (this week's last cook
// was logged), and not for a week the owner planned, nor on the days after.
//
// A made-up owner whose meal week starts on Sunday: this one is Sunday 15th to
// Saturday 21st. Today is Wednesday 18th.

const profile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const TODAY = "2026-11-18";
const week: WeekPlan = {
  start: "2026-11-15",
  cooks: [{ id: "2026-11-15-bolognese", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 }],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  createdOn: "2026-11-14",
};
const sized = (p: WeekPlan): WeekPlan => ({ ...p, cooks: sizeCooks(p, profile.routine as never, 2700) });
const next = (o: Partial<WeekPlan>): WeekPlan => ({ ...week, start: "2026-11-22", cooks: [], ...o });
const line = (plan: WeekPlan) =>
  yourDay(
    TODAY,
    null,
    buildState(
      {
        profile,
        weights: [],
        plans: [sized(week), plan].map((data) => ({ start: data.start, data })),
        meals: [],
        batches: [],
        ratings: [],
        lastHad: {},
        stock: [],
        products: [],
        sessions: [],
        sets: [],
      } satisfies LifeRaw,
      TODAY,
    ),
    9 * 60,
  ).items.find((i) => i.key === "next-week");

test("Today says next week is planned on the day it planned itself, and links to it", () => {
  const it = line(next({ auto: true, createdOn: TODAY }));
  assert.equal(it?.title, "Next week is planned");
  assert.equal(it?.href, "/life?week=next");
  // Untimed, like the "plan this week" nudge: never what is next.
  assert.equal(it?.start, -1);
});

test("Today says nothing of a next week planned by hand, or one that planned itself on an earlier day", () => {
  assert.equal(line(next({ createdOn: TODAY })), undefined, "planned by hand");
  assert.equal(line(next({ auto: true, createdOn: "2026-11-17" })), undefined, "planned itself yesterday");
});
