import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay, type Kept } from "./day.ts";
import { lifeBlocks } from "./life-plan.ts";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import type { Trip, WeekPlan } from "../life/planner.ts";
import { buildState, type LifeRaw } from "../life/state.ts";
import type { Block } from "./schedule.ts";

// A fresh week's shop that went by without being done reads Missed on Today, and is
// offered the next free half hour in one tap; one from an earlier day of the meal
// week is carried to Today the same way. Made-up owner and week: the meal week
// starts Sunday 15th, and it is Monday 16th.

const SUN = "2026-11-15";
const MON = "2026-11-16";
const WED = "2026-11-18";
const at = (h: number, m = 0) => h * 60 + m;

const profile = { ...DEFAULT_PROFILE, body: { sex: "male" as const, birthYear: 1990, heightCm: 175 } };
const trip = (id: string, date: string, start: number, changes: Partial<Trip> = {}): Trip => ({
  id,
  date,
  start,
  ...changes,
});
const week = (trips: Trip[]): WeekPlan => ({
  start: SUN,
  mode: "fresh",
  cooks: [
    { id: "mon-bol", recipe: "bolognese", date: MON, start: at(18), portions: 3, scale: 1 },
    { id: "wed-parm", recipe: "chicken-parm", date: WED, start: at(18), portions: 3, scale: 1 },
  ],
  trips,
  breakfast: "",
  shake: "",
  fresh: [],
  out: [],
});
const state = (trips: Trip[]) => {
  const raw: LifeRaw = {
    profile,
    weights: [],
    plans: [{ start: SUN, data: week(trips) }],
    meals: [],
    batches: [],
    ratings: [],
    lastHad: {},
    stock: [],
    products: [],
    sessions: [],
    sets: [],
  };
  return buildState(raw, MON);
};
const kept: Kept = { logs: [], lastDay: "2026-11-22" };
/** Today as the page builds it: the Schedule's blocks for the day (the Life plan's among them), then Your day. */
const today = (trips: Trip[], now: number, others: Block[] = []) => {
  const s = state(trips);
  const plan = lifeBlocks(s, [MON, "2026-11-17"], others, { date: MON, minutes: now }).blocks;
  return yourDay(MON, [...others, ...plan], s, now, kept);
};

test("today's shop that went by reads Missed, with the next free half hour as one tap", () => {
  const d = today([trip("trip-mon", MON, at(8)), trip("trip-wed", WED, at(17, 15))], at(9, 30));
  const shop = d.items.find((i) => i.kind === "shop" && i.start >= 0);
  assert.ok(shop, "the shop is on Today");
  assert.equal(shop.tripId, "trip-mon");
  assert.equal(shop.missed, true);
  assert.deepEqual(shop.move, {
    source: "shop",
    id: "trip-mon",
    week: SUN,
    date: MON,
    start: at(9, 30),
    duration: 30,
    label: "Move to 09:30",
  });
  // Not missed before its half hour is over, nor while it is being ticked off in the shop.
  const early = today([trip("trip-mon", MON, at(9, 15)), trip("trip-wed", WED, at(17, 15))], at(9, 30));
  assert.equal(early.items.find((i) => i.kind === "shop" && i.start >= 0)?.missed, undefined);
  const ticking = today([trip("trip-mon", MON, at(8), { ticked: ["milk"] })], at(9, 30));
  assert.equal(ticking.items.find((i) => i.kind === "shop" && i.start >= 0)?.missed, undefined);
});

test("a shop missed on an earlier day of the meal week is carried to Today, first, with its list", () => {
  const d = today([trip("trip-sun", SUN, at(10)), trip("trip-wed", WED, at(17, 15))], at(9, 30));
  assert.equal(d.carried.length, 1);
  const [c] = d.carried;
  assert.equal(c.key, "shop-trip-sun");
  assert.equal(c.kind, "shop");
  assert.equal(c.date, SUN);
  assert.equal(c.missed, true);
  assert.match(c.detail, /^10:00 · \d+ items?, (about )?£\d+\.\d\d$/);
  assert.equal(c.href, "/life/kitchen");
  assert.deepEqual(c.move, {
    source: "shop",
    id: "trip-sun",
    week: SUN,
    date: MON,
    start: at(9, 30),
    duration: 30,
    label: "Move to 09:30",
  });
  // A shop done, or one with nothing left to buy, is not.
  const done = today([trip("trip-sun", SUN, at(10), { doneOn: SUN }), trip("trip-wed", WED, at(17, 15))], at(9, 30));
  assert.deepEqual(done.carried, []);
});

test("a shop's offer is a free half hour by 22:00, never one a missed study block is offered, else tomorrow morning", () => {
  // A study block from 07:00, missed too: it is offered 09:30, so the shop 10:30.
  const studied: Block = {
    id: "t1:2026-11-16",
    source: "asana",
    title: "Chapter 4",
    date: MON,
    start: at(7),
    end: at(8),
    url: "/tasks?task=t1",
    editable: true,
    taskGid: "t1",
  };
  const shared = today([trip("trip-sun", SUN, at(10)), trip("trip-wed", WED, at(17, 15))], at(9, 30), [studied]);
  assert.equal(shared.items.find((i) => i.key === studied.id)?.move?.label, "Move to 09:30");
  assert.equal(shared.carried[0].move?.label, "Move to 10:30");
  // Past 22:00 today: tomorrow from the morning.
  const late = today([trip("trip-sun", SUN, at(10)), trip("trip-wed", WED, at(17, 15))], at(22, 10));
  assert.equal(late.carried[0].move?.label, "Tomorrow 09:00");
  assert.equal(late.carried[0].move?.date, "2026-11-17");
});
