import { test } from "node:test";
import assert from "node:assert/strict";
import { firstShopFirst, type Cook, type Trip, type WeekPlan } from "./planner.ts";
import { DEFAULT_PROFILE, plannerRoutine } from "./profile.ts";
import { recipe } from "./recipes.ts";
import { freshStart, moveSaid, moveShop, undoMove, type ShopMoveInput } from "./shop-move.ts";
import type { Use } from "./shopping.ts";

// A made-up fresh week from Sunday 15 November: shops on Sunday at 10:00 and
// Wednesday at 17:15, and a short cook of one dish at 18:00 on Sunday, Monday,
// Wednesday and Friday. Sunday's shop buys for Sunday's and Monday's dishes,
// Wednesday's for Wednesday's and Friday's.

const START = "2026-11-15";
const SUN = "2026-11-15";
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const FRI = "2026-11-20";
const SAT = "2026-11-21";
const at = (h: number, m = 0) => h * 60 + m;

const cook = (id: string, key: string, date: string, start = at(18)): Cook => ({
  id,
  recipe: key,
  date,
  start,
  portions: 3,
  scale: 1,
});
const week = (changes: Partial<WeekPlan> = {}): WeekPlan => ({
  start: START,
  mode: "fresh",
  cooks: [
    cook("sun-parm", "chicken-parm", SUN),
    cook("mon-bol", "bolognese", MON),
    cook("wed-tuscan", "tuscan-chicken", WED),
    cook("fri-pesto", "pesto-chicken", FRI),
  ],
  trips: [
    { id: "trip-sun", date: SUN, start: at(10) },
    { id: "trip-wed", date: WED, start: at(17, 15) },
  ],
  breakfast: "",
  shake: "",
  fresh: [],
  out: [],
  ...changes,
});
/** What a dish's cook takes from a shop, as the shopping list records it. */
const takes = (c: Cook): Use => ({ date: c.date, time: c.start, qty: 1, use: recipe(c.recipe)!.name });
const plan = week();
const buys = new Map<string, Use[]>([
  ["trip-sun", plan.cooks.slice(0, 2).map(takes)],
  ["trip-wed", plan.cooks.slice(2).map(takes)],
]);
// Monday 09:30: Sunday's shop has gone by, not done.
const input: ShopMoveInput = {
  today: MON,
  now: at(9, 30),
  cooked: new Set(),
  buys,
  routine: plannerRoutine(DEFAULT_PROFILE),
};
const moved = (p: WeekPlan, id: string, to: { date: string; start: number }, changes: Partial<ShopMoveInput> = {}) => {
  const out = moveShop(p, id, to, { ...input, ...changes });
  if ("error" in out) throw new Error(out.error);
  return out;
};
const where = (p: WeekPlan) => Object.fromEntries(p.cooks.map((c) => [c.id, `${c.date} ${c.start}`]));

test("a missed shop moves, and the cook that needed its food follows it to that evening", () => {
  const m = moved(plan, "trip-sun", { date: MON, start: at(9, 30) });
  assert.deepEqual(m.plan.trips, [
    { id: "trip-sun", date: MON, start: at(9, 30), moved: true },
    { id: "trip-wed", date: WED, start: at(17, 15) },
  ]);
  // Sunday's dish needed Sunday's food: it is cooked at its own time on Monday, with Monday's.
  assert.deepEqual(where(m.plan), {
    "sun-parm": `${MON} ${at(18)}`,
    "mon-bol": `${MON} ${at(18)}`,
    "wed-tuscan": `${WED} ${at(18)}`,
    "fri-pesto": `${FRI} ${at(18)}`,
  });
  assert.deepEqual(m.cooks, [
    { recipe: "chicken-parm", from: { date: SUN, start: at(18) }, to: { date: MON, start: at(18) } },
  ]);
  assert.deepEqual([m.joined, m.fresh, m.early], [[], [], []]);
  assert.equal(
    moveSaid(m, { date: MON, start: at(9, 30) }, MON),
    "Shop moved to today 09:30. Chicken parmigiana with spaghetti moves to today 18:00.",
  );
  // The week it was given is left as it was.
  assert.equal(plan.trips![0].date, SUN);
  assert.equal(plan.cooks[0].date, SUN);
});

test("a cook whose food is in the kitchen, or came from an earlier shop, stays where it is", () => {
  const own = new Map([["trip-sun", [takes(plan.cooks[1])]]]);
  const m = moved(plan, "trip-sun", { date: MON, start: at(9, 30) }, { buys: own });
  assert.equal(m.plan.cooks[0].date, SUN);
  assert.deepEqual(m.cooks, []);
  // A cook already cooked stays too, whatever it needed.
  const cooked = moved(plan, "trip-sun", { date: MON, start: at(9, 30) }, { cooked: new Set(["sun-parm"]) });
  assert.deepEqual(cooked.cooks, []);
});

test("a cook the food would reach too late that day starts as soon as it is put away", () => {
  const m = moved(plan, "trip-sun", { date: MON, start: at(17, 30) });
  // In by 18:15: Sunday's dish and Monday's both start then.
  assert.equal(m.plan.cooks[0].date, MON);
  assert.equal(m.plan.cooks[0].start, at(18, 15));
  assert.equal(m.plan.cooks[1].start, at(18, 15));
  // Too late at night, the next day at its own time.
  const late = moved(plan, "trip-sun", { date: MON, start: at(21, 45) });
  assert.deepEqual(where(late.plan)["sun-parm"], `${TUE} ${at(18)}`);
  assert.deepEqual(where(late.plan)["mon-bol"], `${TUE} ${at(18)}`);
});

test("moved past the week's last evening, a dish stays and is said, early on the list", () => {
  const m = moved(plan, "trip-wed", { date: SAT, start: at(21, 45) });
  assert.equal(m.plan.cooks[2].date, WED);
  assert.equal(m.plan.cooks[3].date, FRI);
  assert.deepEqual(m.early, ["Creamy Tuscan chicken pasta", "Nut-free pesto chicken pasta"]);
  assert.match(moveSaid(m, { date: SAT, start: at(21, 45) }, MON), /still needs it first: move that in the Kitchen\.$/);
});

test("a shop moved onto another's day, or past it, joins it, with both baskets", () => {
  const ticked = week({
    trips: [
      { id: "trip-sun", date: SUN, start: at(10), missing: ["peppers"], via: "store" },
      { id: "trip-wed", date: WED, start: at(17, 15), ticked: ["eggs"] },
    ],
  });
  const m = moved(ticked, "trip-sun", { date: WED, start: at(12) });
  assert.deepEqual(m.plan.trips, [
    { id: "trip-sun", date: WED, start: at(12), moved: true, ticked: ["eggs"], missing: ["peppers"], via: "store" },
  ]);
  assert.deepEqual(m.joined, [WED]);
  // Both of Sunday's dishes wait for it; Wednesday's own is late enough already.
  assert.deepEqual(where(m.plan), {
    "sun-parm": `${WED} ${at(18)}`,
    "mon-bol": `${WED} ${at(18)}`,
    "wed-tuscan": `${WED} ${at(18)}`,
    "fri-pesto": `${FRI} ${at(18)}`,
  });
  assert.match(
    moveSaid(m, { date: WED, start: at(12) }, MON),
    /^Shop moved to Wednesday 12:00, with Wednesday's shop\./,
  );
  // Past Wednesday's shop to Thursday: the same one trip, and Wednesday's dish waits too.
  const past = moved(plan, "trip-sun", { date: "2026-11-19", start: at(10) });
  assert.equal(past.plan.trips?.length, 1);
  assert.equal(where(past.plan)["wed-tuscan"], `2026-11-19 ${at(18)}`);
});

test("a meal cooked fresh from the shop moves to the same meal on the first later day with room", () => {
  const routine = plannerRoutine(DEFAULT_PROFILE);
  const lasagne = recipe("lasagne")!;
  const withFresh = week({ fresh: [{ date: SUN, slot: "dinner", recipe: "lasagne" }], out: [`${MON}:dinner`] });
  const own = new Map([
    [
      "trip-sun",
      [...plan.cooks.slice(0, 2).map(takes), { date: SUN, time: routine.dinner, qty: 1, use: lasagne.name }],
    ],
  ]);
  const m = moved(withFresh, "trip-sun", { date: MON, start: at(9, 30) }, { buys: own });
  // Monday's dinner is out, so Tuesday's.
  assert.deepEqual(m.plan.fresh, [{ date: TUE, slot: "dinner", recipe: "lasagne" }]);
  assert.deepEqual(m.fresh, [{ recipe: "lasagne", slot: "dinner", from: SUN, to: TUE }]);
  assert.match(moveSaid(m, { date: MON, start: at(9, 30) }, MON), /Beef lasagne moves to tomorrow's dinner\.$/);
  // Cooking fresh starts before the meal: a 110-minute dish served at 19:00 starts at 17:30.
  assert.equal(freshStart(at(19), 110), at(17, 30));
  assert.equal(freshStart(at(19), 20), at(19));
});

test("a shop moves only to a time still to come, in its week, between 06:00 and 22:00, and not once done", () => {
  const error = (p: WeekPlan, to: { date: string; start: number }, id = "trip-sun") => {
    const out = moveShop(p, id, to, input);
    return "error" in out ? out.error : null;
  };
  assert.equal(error(plan, { date: "2026-11-22", start: at(10) }), "Pick a day in this meal week.");
  assert.equal(error(plan, { date: "2026-11-14", start: at(10) }), "Pick a day in this meal week.");
  assert.equal(error(plan, { date: MON, start: at(23) }), "Pick a time between 06:00 and 22:00.");
  assert.equal(error(plan, { date: MON, start: at(8) }), "Pick a time still to come.");
  assert.equal(error(plan, { date: SUN, start: at(18) }), "Pick a time still to come.");
  // Under way, it still counts: an offer made at 09:30 and tapped a moment later.
  assert.equal(error(plan, { date: MON, start: at(9, 15) }), null);
  const done = week({ trips: [{ id: "trip-sun", date: SUN, start: at(10), doneOn: SUN }] });
  assert.equal(error(done, { date: MON, start: at(11) }), "That shop is done already.");
  assert.match(error(plan, { date: MON, start: at(11) }, "trip-gone") ?? "", /^That shop isn't in this week's plan/);
  assert.match(error(week({ mode: undefined }), { date: MON, start: at(11) }) ?? "", /^That shop isn't/);
});

test("Undo puts the week back exactly, unless a shop has been done since", () => {
  const withFresh = week({ fresh: [{ date: SUN, slot: "dinner", recipe: "lasagne" }] });
  const m = moved(withFresh, "trip-sun", { date: WED, start: at(12) });
  const back = undoMove(m.plan, new Set());
  assert.ok(back);
  assert.deepEqual(back.trips, withFresh.trips);
  assert.deepEqual(where(back), where(withFresh));
  assert.deepEqual(back.fresh, withFresh.fresh);
  assert.equal(back.lastMove, undefined);
  // A dish cooked since stays cooked where it was.
  const cooked = undoMove(m.plan, new Set(["sun-parm"]));
  assert.equal(where(cooked!)["sun-parm"], `${WED} ${at(18)}`);
  // Nothing to undo, or the moved shop done since: no.
  assert.equal(undoMove(withFresh, new Set()), null);
  const shopped = { ...m.plan, trips: m.plan.trips!.map((t) => ({ ...t, doneOn: WED })) };
  assert.equal(undoMove(shopped, new Set()), null);
});

test("a first shop the owner moved stays where they put it", () => {
  // A week from Saturday whose routine shops on Sunday: its first shop comes on Saturday...
  const routine: Trip[] = [{ id: "trip-sun", date: "2026-11-22", start: at(10) }];
  assert.equal(firstShopFirst("2026-11-21", "2026-11-20", routine)[0].date, "2026-11-21");
  // ...unless the owner moved it to Sunday.
  const mine: Trip[] = [{ ...routine[0], moved: true }];
  assert.equal(firstShopFirst("2026-11-21", "2026-11-20", mine)[0].date, "2026-11-22");
});
