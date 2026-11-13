import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState, effort, remainingNeeds, routineFor, unlogged, type LifeRaw } from "./state.ts";
import { DEFAULT_PROFILE } from "./profile.ts";
import { sizeCooks, type WeekPlan } from "./planner.ts";

const profile = {
  ...DEFAULT_PROFILE,
  body: { sex: "male", birthYear: 1997, heightCm: 180 },
  routine: { ...DEFAULT_PROFILE.routine, shake: 510 },
};
const plan0: WeekPlan = {
  start: "2026-11-15",
  cooks: [
    { id: "a", recipe: "bolognese", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
    { id: "b", recipe: "cottage-pie", date: "2026-11-15", start: 990, portions: 0, scale: 1 },
  ],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  createdOn: "2026-11-16",
};
const raw = (over: Partial<LifeRaw> = {}): LifeRaw => ({
  profile,
  weights: [{ day: "2026-11-16", kg: 65 }],
  plans: [{ start: "2026-11-15", data: { ...plan0, cooks: sizeCooks(plan0, profile.routine as never, 2700) } }],
  meals: [],
  batches: [],
  ratings: [],
  lastHad: {},
  stock: [],
  products: [],
  sessions: [],
  sets: [],
  ...over,
});

test("the day runs in time order, gym on gym days", () => {
  const s = buildState(raw(), "2026-11-16");
  const items = routineFor(s, "2026-11-16");
  const times = items.map((i) => i.time);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );
  assert.ok(
    items.some((i) => i.kind === "gym"),
    "Monday is a gym day",
  );
  assert.equal(items[0].kind, "weigh");
  assert.equal(items[0].done, true);
});

test("days before the plan was made are not missed meals", () => {
  const s = buildState(raw(), "2026-11-18");
  const missing = unlogged(s, "2026-11-18");
  assert.ok(missing.length > 0);
  assert.ok(missing.every((p) => p.date >= "2026-11-16"));
});

test("a done cook is out of the shopping needs", () => {
  const before = remainingNeeds(buildState(raw(), "2026-11-15"));
  assert.ok(before.some((n) => n.item === "beef-mince"));
  const after = remainingNeeds(
    buildState(
      raw({
        batches: [
          {
            gid: "1",
            recipe: "bolognese",
            cookedOn: "2026-11-15",
            portions: 4,
            remaining: 4,
            scale: 1,
            location: "fridge",
            planStart: "2026-11-15",
            cookId: "a",
          },
        ],
      }),
      "2026-11-15",
    ),
  );
  const mince = (list: typeof before) => list.find((n) => n.item === "beef-mince")?.qty ?? 0;
  assert.ok(mince(after) < mince(before));
  assert.ok(!after.some((n) => n.uses.includes("Spaghetti bolognese")));
});

test("effort counts the week so far", () => {
  const s = buildState(
    raw({
      meals: [
        {
          day: "2026-11-16",
          slot: "breakfast",
          status: "eaten",
          recipe: "bagel-ham",
          batchGid: null,
          kcal: 600,
          protein: 30,
          note: null,
        },
      ],
    }),
    "2026-11-17",
  );
  const e = effort(s, "2026-11-16");
  assert.equal(e.weigh.done, 1);
  assert.equal(e.weigh.days, 2);
  assert.equal(e.eat.eaten, 1);
  assert.ok(e.eat.planned >= 3);
});

test("across the changeover, tomorrow's routine comes from next week's plan", () => {
  const next: WeekPlan = {
    ...plan0,
    start: "2026-11-22",
    createdOn: "2026-11-20",
    cooks: [{ id: "n1", recipe: "lasagne", date: "2026-11-22", start: 990, portions: 0, scale: 1 }],
  };
  const s = buildState(
    raw({
      plans: [
        ...raw().plans,
        { start: "2026-11-22", data: { ...next, cooks: sizeCooks(next, profile.routine as never, 2700) } },
      ],
    }),
    "2026-11-21",
  );
  assert.equal(s.next.start, "2026-11-22");
  assert.ok(s.next.plan);
  const sunday = routineFor(s, "2026-11-22");
  assert.ok(sunday.some((i) => i.kind === "cook" && i.title.includes("Beef lasagne")));
  assert.ok(remainingNeeds(s, s.next).some((n) => n.uses.includes("Beef lasagne")));
});
