import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import type { Trip, WeekPlan } from "./planner.ts";
import { splitTrips, type Need } from "./shopping.ts";
import { buildState, kitchenFor, tripLists, weekView, type LifeRaw } from "./state.ts";
import { suggestWeek } from "./suggest.ts";

// Shops line up with the meal week: a shop doesn't buy for a meal earlier that day,
// a week's first shop comes on its first day, next week's food wanted before its
// first shop goes on this week's last one, and next week counts what this week's
// shops still to come will leave over.

const use = (item: string, date: string, time: number, qty: number): Need => ({
  item,
  qty,
  firstUse: date,
  uses: ["x"],
  at: [{ date, qty, use: "x", time }],
});

test("a shop doesn't buy for a meal earlier that day, and a meal earlier in the week is flagged early", () => {
  const friday = [{ id: "fri", date: "2026-11-20", start: 17 * 60 + 15 }];
  const { trips } = splitTrips(
    [
      use("oats", "2026-11-20", 6 * 60, 80),
      use("chicken-breast", "2026-11-20", 19 * 60, 300),
      use("milk", "2026-11-19", 6 * 60, 200),
    ],
    friday,
    [],
    [],
  );
  assert.deepEqual(trips[0].needs.map((n) => n.item).sort(), ["chicken-breast", "milk"]);
  assert.deepEqual(trips[0].early, ["milk"]);
});

test("a fresh week's first shop is on its first day when the routine's first shop day is later", () => {
  const profile = { ...DEFAULT_PROFILE, body: { sex: "male" as const, birthYear: 1990, heightCm: 175 } };
  // A week from Saturday 21st, planned the day before: the routine shops Sunday and Wednesday.
  const next = suggestWeek(profile, "2026-11-21", [], {}, {}, "2026-11-20", "fresh");
  assert.equal(next.trips?.[0]?.date, "2026-11-21");
  // Planned on its last day, the missed shops come today, as before.
  const late = suggestWeek(profile, "2026-11-14", [], {}, {}, "2026-11-20", "fresh");
  assert.equal(late.trips?.[0]?.date, "2026-11-20");
});

// A made-up owner whose meal week starts on Saturday. Today is Friday 20th, the
// week's last day, with a shop at 17:15; next week's first shop is on Sunday.
const trip = (id: string, date: string, start: number): Trip => ({ id, date, start });
const fresh = (start: string, trips: Trip[], dinners: [string, string][], breakfast = ""): WeekPlan => ({
  start,
  cooks: [],
  breakfast,
  shake: "",
  fresh: dinners.map(([date, recipe]) => ({ date, slot: "dinner", recipe })),
  out: [],
  mode: "fresh",
  trips,
});
// Next week was saved with its first shop on Sunday, as the routine had it, and
// porridge every morning at 6.
const raw: LifeRaw = {
  profile: { ...DEFAULT_PROFILE, routine: { ...DEFAULT_PROFILE.routine, cooks: [{ weekday: 5, start: 1020 }] } },
  weights: [],
  plans: [
    fresh("2026-11-14", [trip("fri", "2026-11-20", 17 * 60 + 15)], [["2026-11-20", "chicken-parm"]]),
    fresh(
      "2026-11-21",
      [trip("sun", "2026-11-22", 10 * 60), trip("wed", "2026-11-25", 17 * 60 + 15)],
      [
        ["2026-11-21", "bolognese"],
        ["2026-11-22", "tuscan-chicken"],
      ],
      "porridge",
    ),
  ].map((data) => ({ start: data.start, data })),
  meals: [],
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
};
const s = buildState(raw, "2026-11-20");
const items = (which: "this" | "next") =>
  tripLists(s, weekView(s, which))
    .open[0].lines.filter((l) => l.packs > 0)
    .map((l) => l.item.key);

test("a saved week's first shop moves to its first day, until a shop is done", () => {
  const next = weekView(s, "next").plan!;
  assert.deepEqual(
    next.trips!.map((t) => t.date),
    ["2026-11-21", "2026-11-25"],
  );
  // The other copies operations save from are moved too, so a shop done stays on its day.
  assert.equal(s.plans.find((p) => p.start === "2026-11-21")!.data.trips![0].date, "2026-11-21");
  // Once a shop is done, the week is left as it is.
  const done = buildState(
    {
      ...raw,
      plans: raw.plans.map((p) =>
        p.start === "2026-11-21"
          ? { ...p, data: { ...p.data, trips: p.data.trips!.map((t) => ({ ...t, doneOn: "2026-11-20" })) } }
          : p,
      ),
    },
    "2026-11-20",
  );
  assert.equal(weekView(done, "next").plan!.trips![0].date, "2026-11-22");
});

test("next week's food wanted before its first shop goes on this week's last shop, and the rest on its own", () => {
  // Saturday's porridge at 6 comes before Saturday's shop at 10: Friday's shop buys it.
  assert.ok(items("this").includes("oats"), items("this").join(", "));
  // Saturday's bolognese at dinner comes after Saturday's shop, which buys its mince.
  assert.ok(items("next").includes("beef-mince"), items("next").join(", "));
  assert.ok(!items("this").includes("beef-mince"), items("this").join(", "));
});

test("next week counts what this week's shop still to come will leave over", () => {
  const pasta = kitchenFor(s, weekView(s, "next")).find((r) => r.item === "pasta");
  assert.ok(pasta && pasta.qty > 0, "the rest of Friday's pasta pack");
  // Today's kitchen is only what is in: nothing yet.
  assert.equal(kitchenFor(s, weekView(s, "this")).length, 0);
});
