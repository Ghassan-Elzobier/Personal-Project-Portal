import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES } from "./allergens.ts";
import { reminders, type WeekPlan } from "./planner.ts";
import { buildList, frozenOnArrival, type Need } from "./shopping.ts";

// Raw food frozen the day it arrives (its use is past its fridge life) gets a
// reminder the evening before it is needed, to move it to the fridge: the FSA
// says defrost in the fridge, never on the side.

const need = (item: string, qty: number, firstUse: string): Need => ({ item, qty, firstUse, uses: ["x"] });

test("what a shop freezes on arrival is recorded with the day it is first wanted", () => {
  // Delivered Sunday; chicken keeps 3 days, so Friday's chicken is frozen; onions keep.
  const lines = buildList(
    [
      need("chicken-thigh", 700, "2026-11-20"),
      need("chicken-breast", 500, "2026-11-16"),
      need("onion", 2, "2026-11-20"),
    ],
    [],
    [],
    NO_RULES,
    "2026-11-15",
  );
  const all = lines.map((l) => l.item.key);
  assert.deepEqual(frozenOnArrival(lines, all), [{ item: "chicken-thigh", for: "2026-11-20" }]);
  // Not delivered (missing from the shop): nothing to defrost.
  assert.deepEqual(
    frozenOnArrival(
      lines,
      all.filter((k) => k !== "chicken-thigh"),
    ),
    [],
  );
});

const plan = (o: Partial<WeekPlan>): WeekPlan => ({
  start: "2026-11-15",
  cooks: [],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
  ...o,
});

test("food frozen on arrival gets a defrost reminder at 9pm the evening before it is wanted", () => {
  const delivered = plan({
    shop: { deliveredOn: "2026-11-15", frozen: [{ item: "chicken-thigh", for: "2026-11-20" }] },
  });
  const tripped = plan({
    mode: "fresh",
    trips: [
      {
        id: "t",
        date: "2026-11-15",
        start: 600,
        doneOn: "2026-11-15",
        frozen: [{ item: "beef-mince", for: "2026-11-19" }],
      },
    ],
  });
  const defrost = (p: WeekPlan) => reminders(p, []).filter((r) => r.kind === "defrost");
  assert.deepEqual(defrost(delivered), [
    {
      date: "2026-11-19",
      time: 21 * 60,
      kind: "defrost",
      text: "Move the chicken thigh fillets from the freezer to the fridge tonight, for tomorrow.",
    },
  ]);
  assert.equal(defrost(tripped)[0]?.date, "2026-11-18");
  assert.deepEqual(defrost(plan({})), []);
});
