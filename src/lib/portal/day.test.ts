import { test } from "node:test";
import assert from "node:assert/strict";
import { yourDay } from "./day.ts";
import { lifeBlocks } from "./life-plan.ts";
import { buildState, type LifeRaw } from "../life/state.ts";
import { DEFAULT_PROFILE, type LifeProfile } from "../life/profile.ts";
import { sizeCooks, type WeekPlan } from "../life/planner.ts";
import { suggestWeek } from "../life/suggest.ts";
import type { Block } from "./schedule.ts";

// Saturday 14th: gym 06:45, cook 17:00 (bolognese and butter chicken), study 09:30-11:30, an event 18:00-21:00.
const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  gym: { ...DEFAULT_PROFILE.gym, days: [1, 3, 5], start: 405, minutes: 65 },
  routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 1020 }] },
};
const plan0: WeekPlan = {
  start: "2026-11-14",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-14", start: 1020, portions: 0, scale: 1 },
    { id: "b", recipe: "butter-chicken", date: "2026-11-14", start: 1020, portions: 0, scale: 1 },
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
  meals: [
    { day: "2026-11-14", slot: "breakfast", status: "eaten", recipe: "porridge", kcal: 600, protein: 40 },
  ] as never,
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
};
const date = "2026-11-14";
const study: Block = {
  id: "t1:2026-11-14",
  source: "asana",
  title: "Ch 3 Multidimensional grids",
  date,
  start: 570,
  end: 690,
  url: "/tasks?task=t1",
  editable: true,
  project: "PMPP 5e",
  taskGid: "t1",
};
const event: Block = {
  id: "e1:2026-11-14",
  source: "google",
  title: "Send-off",
  date,
  start: 18 * 60,
  end: 21 * 60,
  url: "https://calendar.google.com/x",
  editable: false,
};

test("your day is the Schedule's day: study, events and the Life plan at the Schedule's times", () => {
  const s = buildState(raw, date);
  const others = [study, event];
  const plan = lifeBlocks(s, [date], others, { date, minutes: 8 * 60 }).blocks;
  const blocks = [...others, ...plan].sort((a, b) => a.start - b.start);
  const day = yourDay(date, blocks, s, 10 * 60);
  const kinds = day.items.map((i) => i.kind);
  for (const k of ["weigh", "meal", "gym", "study", "event", "cook"]) assert.ok(kinds.includes(k as never), `has ${k}`);
  // Same times as the Schedule, in order.
  for (const b of blocks) assert.equal(day.items.find((i) => i.key === b.id)?.start, b.start, b.title);
  assert.deepEqual(
    day.items.map((i) => i.start),
    [...day.items.map((i) => i.start)].sort((a, b) => a - b),
  );
  // Life knows what is done, and what a cook makes.
  const breakfast = day.items.find((i) => i.kind === "meal" && i.title === "Breakfast")!;
  assert.equal(breakfast.done, true);
  const cook = day.items.find((i) => i.kind === "cook")!;
  assert.deepEqual(cook.cookIds?.sort(), ["a", "b"]);
  // Study can be logged, and at 10:00 it is what comes next.
  assert.equal(day.items.find((i) => i.kind === "study")?.taskGid, "t1");
  assert.equal(day.nextKey, study.id);
  assert.match(day.summary ?? "", /2 h study/);
  // The event opens in Google; the cook clashes with it and moved, and says so.
  assert.equal(day.items.find((i) => i.kind === "event")?.external, true);
  assert.ok(cook.note, "the cook moved for the send-off");
});

test("without the Schedule, the Life items still show at their planned times", () => {
  const s = buildState(raw, date);
  const day = yourDay(date, null, s, 0);
  assert.ok(day.items.some((i) => i.kind === "gym" && i.start === 405));
  assert.ok(day.items.some((i) => i.kind === "cook"));
});

test("a fresh week's shop is on your day with its list, comes next when it is next, and ticks when done", () => {
  // Weeks from Sunday, with the default fresh routine: Sunday's shop is at 10:00.
  const p: LifeProfile = {
    ...profile,
    body: { ...profile.body, sex: "male" },
    routine: { ...profile.routine, cooks: [{ weekday: 6, start: 1080 }] },
  };
  const sunday = "2026-11-15";
  const week = suggestWeek(p, sunday, [], {}, {}, sunday, "fresh");
  const r = { ...p.routine, gymDays: p.gym.days, gymEnd: 405 + 65 };
  const plan: WeekPlan = { ...week, cooks: sizeCooks(week, r as never, 2700) };
  const stateOf = (data: WeekPlan) =>
    buildState({ ...raw, profile: p, meals: [], plans: [{ start: sunday, data }] }, sunday);
  const dayOf = (data: WeekPlan) => {
    const s = stateOf(data);
    return yourDay(sunday, lifeBlocks(s, [sunday], [], { date: sunday, minutes: 9 * 60 }).blocks, s, 9 * 60);
  };

  const day = dayOf(plan);
  const shop = day.items.find((i) => i.kind === "shop")!;
  assert.equal(shop.key, "plan-2026-11-15:shop:600");
  assert.equal(shop.start, 600);
  assert.equal(shop.title, "Shop");
  assert.match(shop.detail, /^\d+ items?, (about )?£\d+\.\d\d$/);
  assert.equal(shop.href, "/life/kitchen");
  assert.equal(shop.done, false);
  assert.equal(day.nextKey, shop.key, "at 09:00 the shop is next");

  const done = dayOf({ ...plan, trips: plan.trips!.map((t) => (t.date === sunday ? { ...t, doneOn: sunday } : t)) });
  const ticked = done.items.find((i) => i.kind === "shop")!;
  assert.equal(ticked.done, true);
  assert.equal(ticked.detail, "Done");
  assert.notEqual(done.nextKey, ticked.key);

  // Without the Schedule, the shop still shows at its planned time.
  const alone = yourDay(sunday, null, stateOf(plan), 9 * 60);
  const own = alone.items.find((i) => i.kind === "shop")!;
  assert.equal(own.start, 600);
  assert.equal(own.end, 630);
  assert.equal(own.detail, shop.detail);
});
