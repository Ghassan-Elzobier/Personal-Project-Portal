import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay, type Kept } from "./day.ts";
import { lifeBlocks } from "./life-plan.ts";
import { overlaps } from "../calendar/free-slot.ts";
import { DEFAULT_PROFILE } from "../life/profile.ts";
import type { Cook, Trip, WeekPlan } from "../life/planner.ts";
import { recipe } from "../life/recipes.ts";
import { buildState, type Batch, type LifeRaw } from "../life/state.ts";

// A cook session whose time went by with its dishes not logged reads Missed on Today,
// and is offered the next free time of its length in one tap; one from an earlier day
// of the meal week is carried to Today the same way. Made-up owner and week: the meal
// week starts Sunday 15th, and it is Monday 16th.

const SUN = "2026-11-15";
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const at = (h: number, m = 0) => h * 60 + m;
const bolognese = recipe("bolognese")!.totalMin;

const profile = { ...DEFAULT_PROFILE, body: { sex: "male" as const, birthYear: 1990, heightCm: 175 } };
const cook = (id: string, date: string, start: number, key = "bolognese"): Cook => ({
  id,
  recipe: key,
  date,
  start,
  portions: 3,
  scale: 1,
});
const week = (cooks: Cook[], trips: Trip[] = []): WeekPlan => ({
  start: SUN,
  mode: "fresh",
  cooks,
  trips,
  breakfast: "",
  shake: "",
  fresh: [],
  out: [],
});
const batch = (cookId: string, cookedOn: string): Batch => ({
  gid: `b-${cookId}`,
  recipe: "bolognese",
  cookedOn,
  portions: 3,
  remaining: 3,
  scale: 1,
  location: "fridge",
  planStart: SUN,
  cookId,
});
const state = (plan: WeekPlan, batches: Batch[] = []) => {
  const raw: LifeRaw = {
    profile,
    weights: [],
    plans: [{ start: SUN, data: plan }],
    meals: [],
    batches,
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
/** Today as the page builds it: the Schedule's blocks for today and tomorrow, then Your day. */
const today = (plan: WeekPlan, now: number, batches: Batch[] = []) => {
  const s = state(plan, batches);
  const blocks = lifeBlocks(s, [MON, TUE], [], { date: MON, minutes: now }).blocks;
  return { day: yourDay(MON, blocks, s, now, kept), blocks };
};
const cookRow = (d: ReturnType<typeof yourDay>, start: number) =>
  d.items.find((i) => i.kind === "cook" && i.key === `plan-${MON}:cook:${start}`);

test("an uncooked session whose time has ended reads Missed, with a free time in its meal week by 22:00", () => {
  const { day, blocks } = today(week([cook("mon-bol", MON, at(7)), cook("wed-parm", WED, at(18))]), at(12));
  const row = cookRow(day, at(7));
  assert.ok(row, "the cook is on Today");
  assert.equal(row.missed, true);
  const move = row.move;
  assert.ok(move, "it is offered a new time");
  assert.equal(move.source, "cook");
  assert.equal(move.week, SUN);
  assert.deepEqual(move.from, { date: MON, at: at(7) });
  assert.equal(move.duration, bolognese);
  assert.ok(move.date >= MON && move.date <= "2026-11-21", "in its meal week, today or later");
  assert.ok(move.start <= at(22) && move.start >= at(12), "from now, starting no later than 22:00");
  assert.match(move.label, /^Move to \d\d:\d\d$/);
  for (const b of blocks.filter((x) => x.date === move.date && x.id !== row.key))
    assert.ok(!overlaps(move.start, move.start + move.duration, b.start, b.end), `clear of '${b.title}'`);
});

test("a cooked session, or one still under way, is not missed", () => {
  const plan = week([cook("mon-bol", MON, at(11))]);
  const during = today(plan, at(11) + bolognese - 1).day;
  assert.equal(cookRow(during, at(11))?.missed, undefined);
  const done = today(week([cook("mon-bol", MON, at(7))]), at(12), [batch("mon-bol", MON)]).day;
  assert.equal(cookRow(done, at(7))?.missed, undefined);
  assert.equal(cookRow(done, at(7))?.done, true);
});

test("late in the day, a missed cook is offered tomorrow morning", () => {
  const { day } = today(week([cook("mon-bol", MON, at(7))]), at(22, 10));
  assert.equal(cookRow(day, at(7))?.move?.date, TUE);
  assert.match(cookRow(day, at(7))?.move?.label ?? "", /^Tomorrow \d\d:\d\d$/);
});

test("a cook missed on an earlier day of the meal week is carried to Today, with what it cooks", () => {
  const { day } = today(week([cook("sun-bol", SUN, at(18)), cook("wed-parm", WED, at(18))]), at(9, 30));
  assert.equal(day.carried.length, 1);
  const [c] = day.carried;
  assert.equal(c.kind, "cook");
  assert.equal(c.date, SUN);
  assert.equal(c.missed, true);
  assert.equal(c.detail, `18:00 · ${recipe("bolognese")!.name}`);
  assert.equal(c.href, `/life/cook?day=${SUN}&at=${at(18)}`);
  assert.equal(c.move?.source, "cook");
  assert.deepEqual(c.move?.from, { date: SUN, at: at(18) });
  assert.equal(c.move?.date, MON);
  // Cooked since: not owed.
  const caught = today(week([cook("sun-bol", SUN, at(18))]), at(9, 30), [batch("sun-bol", MON)]).day;
  assert.deepEqual(caught.carried, []);
});

test("while a shop in the meal week is missed, a missed cook gets no move of its own", () => {
  const trips: Trip[] = [{ id: "trip-sun", date: SUN, start: at(10) }];
  const { day } = today(week([cook("sun-bol", SUN, at(18)), cook("mon-bol", MON, at(7))], trips), at(12));
  const shop = day.carried.find((i) => i.kind === "shop");
  assert.ok(shop?.move, "the shop is offered a time");
  const carried = day.carried.find((i) => i.kind === "cook");
  assert.ok(carried, "the earlier cook is still listed");
  assert.equal(carried.move, undefined);
  assert.equal(cookRow(day, at(7))?.missed, true);
  assert.equal(cookRow(day, at(7))?.move, undefined);
});
