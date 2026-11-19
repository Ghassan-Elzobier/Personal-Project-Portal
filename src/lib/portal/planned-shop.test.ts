import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import type { Trip, WeekPlan } from "../life/planner.ts";
import { listTotal } from "../life/shopping.ts";
import { buildState, tripLists, weekView, type LifeRaw } from "../life/state.ts";
import { plannedShop } from "./money.ts";

// The money week runs Monday to Sunday; a meal week starts on the first cook's day.
// plannedShop counts each shop in the money week it is due in.

// Made-up meal plans. A cook weekday of 5 starts the meal week on Saturday, 0 on Monday.
const life = (weekday: number, plans: WeekPlan[]): LifeRaw => ({
  profile: { ...DEFAULT_PROFILE, routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday, start: 1020 }] } },
  weights: [],
  plans: plans.map((data) => ({ start: data.start, data })),
  meals: [],
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
});
const trip = (id: string, date: string): Trip => ({ id, date, start: 600 });
// Different dinners, so one shop's packs don't cover the other's.
const DINNERS = ["chicken-parm", "bolognese", "tuscan-chicken"];
const freshWeek = (start: string, trips: Trip[], dinners: string[]): WeekPlan => ({
  start,
  cooks: [],
  breakfast: "",
  shake: "",
  fresh: dinners.map((date, i) => ({ date, slot: "dinner", recipe: DINNERS[i] })),
  out: [],
  mode: "fresh",
  trips,
});
const batchWeek = (start: string, shop: WeekPlan["shop"]): WeekPlan => ({
  start,
  cooks: [],
  breakfast: "",
  shake: "",
  fresh: [],
  out: [],
  shop,
});
const tripPence = (raw: LifeRaw, today: string, which: "this" | "next", id: string) => {
  const s = buildState(raw, today);
  const x = tripLists(s, weekView(s, which)).open.find((t) => t.trip.id === id);
  return x ? listTotal(x.lines).pence : 0;
};

test("on a meal week's first day, only its shops before Monday count against this week's money", () => {
  // Saturday 14th: the meal week runs to Friday 20th, the money week ends Sunday 15th.
  const raw = life(5, [
    freshWeek("2026-11-14", [trip("sun", "2026-11-15"), trip("tue", "2026-11-17")], ["2026-11-15", "2026-11-17"]),
  ]);
  const sun = tripPence(raw, "2026-11-14", "this", "sun");
  const tue = tripPence(raw, "2026-11-14", "this", "tue");
  assert.ok(sun > 0 && tue > 0, "both shops have something to buy");
  assert.equal(plannedShop(buildState(raw, "2026-11-14")), sun, "Tuesday's shop waits for next week's money");
});

test("late in the money week, next meal week's shops due by Sunday count, and a delivered shop counts nothing", () => {
  // Thursday 19th: this meal week (from Saturday 14th) is delivered; the next starts Saturday 21st.
  const delivered = batchWeek("2026-11-14", {
    orderedOn: "2026-11-13",
    orderedPence: 5_500,
    deliveredOn: "2026-11-14",
  });
  const nextBatch = life(5, [delivered, batchWeek("2026-11-21", { orderedOn: "2026-11-19", orderedPence: 4_200 })]);
  assert.equal(plannedShop(buildState(nextBatch, "2026-11-19")), 4_200, "Saturday's delivery counts this week");
  assert.equal(plannedShop(buildState(life(5, [delivered]), "2026-11-19")), 0, "delivered: nothing left to pay");

  const nextFresh = life(5, [
    delivered,
    freshWeek("2026-11-21", [trip("sat", "2026-11-21"), trip("mon", "2026-11-23")], ["2026-11-21", "2026-11-23"]),
  ]);
  const sat = tripPence(nextFresh, "2026-11-19", "next", "sat");
  assert.ok(sat > 0 && tripPence(nextFresh, "2026-11-19", "next", "mon") > 0);
  assert.equal(plannedShop(buildState(nextFresh, "2026-11-19")), sat, "Saturday's shop counts, Monday's waits");
});

test("when the meal week starts on Monday, the whole meal week's shopping counts, as before", () => {
  const trips = [trip("mon", "2026-11-16"), trip("thu", "2026-11-19"), trip("sun", "2026-11-22")];
  const raw = life(0, [
    freshWeek("2026-11-16", trips, ["2026-11-16", "2026-11-19", "2026-11-22"]),
    batchWeek("2026-11-23", { orderedOn: "2026-11-20", orderedPence: 3_000 }),
  ]);
  const s = buildState(raw, "2026-11-16");
  const whole = tripLists(s, weekView(s, "this")).open.reduce((t, x) => t + listTotal(x.lines).pence, 0);
  assert.ok(whole > 0);
  assert.equal(plannedShop(s), whole, "next meal week's shop is next money week's");

  const batch = life(0, [batchWeek("2026-11-16", { orderedOn: "2026-11-15", orderedPence: 6_100 })]);
  assert.equal(plannedShop(buildState(batch, "2026-11-20")), 6_100);
});
