import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay, type Kept } from "./day.ts";
import { lifeBlocks } from "./life-plan.ts";
import { addDays } from "../dates/week.ts";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import type { SessionLog } from "../life/gym/progress.ts";
import { buildState, type LifeRaw } from "../life/state.ts";

// A gym day whose time went by with no session reads Missed on Today; a gym day
// missed earlier this week is carried to a rest day once, while the week is short.
// Made-up owner and week: gym on Monday, Wednesday and Friday, the week of Monday 16th.

const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";
const at = (h: number, m = 0) => h * 60 + m;

const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male" as const, birthYear: 1990, heightCm: 175 },
  gym: { ...DEFAULT_PROFILE.gym, days: [0, 2, 4], start: at(7), minutes: 60 },
};
const session = (day: string, finished = true): SessionLog => ({ day, workout: "A", finished, feel: null, notes: "" });
const state = (today: string, sessions: SessionLog[]) => {
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
    sessions,
    sets: [],
  };
  return buildState(raw, today);
};
const kept: Kept = { logs: [], lastDay: "2026-11-22" };
/** Today as the page builds it: the Schedule's blocks for today and tomorrow, then Your day. */
const today = (date: string, now: number, sessions: SessionLog[] = []) => {
  const s = state(date, sessions);
  const blocks = lifeBlocks(s, [date, addDays(date, 1)], [], { date, minutes: now }).blocks;
  return yourDay(date, blocks, s, now, kept);
};
const gymRow = (d: ReturnType<typeof yourDay>) => d.items.find((i) => i.kind === "gym");

test("a gym day whose block has ended with no session reads Missed; with a session it does not", () => {
  const missed = gymRow(today(MON, at(12)));
  assert.ok(missed, "the gym is on Today");
  assert.equal(missed.missed, true);
  assert.equal(missed.move, undefined, "no gym time is saved, so there is no move");
  assert.equal(missed.href, "/life/gym");

  assert.equal(gymRow(today(MON, at(7, 30)))?.missed, undefined, "still under way");
  assert.equal(gymRow(today(MON, at(12), [session(MON)]))?.missed, undefined);
  assert.equal(gymRow(today(MON, at(12), [session(MON, false)]))?.missed, undefined, "started, not missed");
});

test("a rest day after a missed gym day this week carries one gym item to the gym page", () => {
  const day = today(TUE, at(9));
  const gym = day.carried.filter((i) => i.kind === "gym");
  assert.equal(gym.length, 1);
  assert.equal(gym[0].date, MON);
  assert.equal(gym[0].missed, true);
  assert.equal(gym[0].href, "/life/gym");
  assert.equal(gym[0].move, undefined);
  assert.match(gym[0].title, /^Gym: /);
  assert.match(gym[0].detail, /^07:00 · \d+ minutes$/);

  // Two missed: still one, the latest.
  const two = today(THU, at(9)).carried.filter((i) => i.kind === "gym");
  assert.equal(two.length, 1);
  assert.equal(two[0].date, WED);
});

test("no gym is carried when the week's sessions are done, on a gym day, or with a session today", () => {
  const gym = (d: ReturnType<typeof yourDay>) => d.carried.filter((i) => i.kind === "gym");
  assert.deepEqual(gym(today(TUE, at(9), [session(MON)])), [], "trained on Monday");
  assert.deepEqual(gym(today(THU, at(9), [session(MON), session(TUE)])), [], "made up on a rest day");
  assert.deepEqual(gym(today(WED, at(9))), [], "a gym day");
  assert.deepEqual(gym(today(TUE, at(9), [session(TUE, false)])), [], "training today");
});
