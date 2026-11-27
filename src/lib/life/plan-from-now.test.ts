import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./profile.ts";
import { firstShopFirst, withDoneShops, type Trip } from "./planner.ts";
import { catchUp, sessionDates, suggestWeek } from "./suggest.ts";

// A week planned again part-way through starts from now, not from this morning: a
// cook or a shop whose time has gone today goes tomorrow, and a shop already done
// today doesn't stop a later one buying what the new plan picked.
//
// A made-up owner with the default routine: a fresh week from Sunday 15th, short
// cooks at 18:00 on Sunday, Monday, Wednesday and Friday, shops on Sunday at 10:00
// and Wednesday at 17:15.

const profile = { ...DEFAULT_PROFILE, body: { sex: "male" as const, birthYear: 1990, heightCm: 175 } };
const START = "2026-11-15";
const at = (h: number, m = 0) => h * 60 + m;
const cooks = sessionDates(START, profile.routine.fresh.cooks);
const when = (xs: { date: string; start: number }[]) => xs.map((x) => `${x.date} ${x.start}`);

test("a catch-up cook goes today while its time is still to come, and otherwise tomorrow", () => {
  // Tuesday at noon: Sunday's and Monday's cooks are gone, so one catch-up at 18:00 today.
  assert.deepEqual(when(catchUp(cooks, "2026-11-17", at(12))), [
    `2026-11-17 ${at(18)}`,
    `2026-11-18 ${at(18)}`,
    `2026-11-20 ${at(18)}`,
  ]);
  // Tuesday at 20:00: 18:00 has gone, and tomorrow has its own cook, so none is added.
  assert.deepEqual(when(catchUp(cooks, "2026-11-17", at(20))), [`2026-11-18 ${at(18)}`, `2026-11-20 ${at(18)}`]);
  // Monday at 19:00: Monday's own cook has gone too, so it goes on Tuesday.
  assert.deepEqual(when(catchUp(cooks, "2026-11-16", at(19))), [
    `2026-11-17 ${at(18)}`,
    `2026-11-18 ${at(18)}`,
    `2026-11-20 ${at(18)}`,
  ]);
  // Monday morning, or with no time given: as before, today's cook stands.
  for (const now of [at(9, 30), undefined])
    assert.deepEqual(when(catchUp(cooks, "2026-11-16", now)), [
      `2026-11-16 ${at(18)}`,
      `2026-11-18 ${at(18)}`,
      `2026-11-20 ${at(18)}`,
    ]);
});

test("the first shop comes to today only while its time is still to come, and otherwise waits until tomorrow", () => {
  const trip = (date: string, start: number): Trip => ({ id: `trip-${date}`, date, start });
  // A week from Saturday whose shops are Sunday and Wednesday: on Saturday morning the first comes to Saturday.
  const weekend = [trip("2026-11-22", at(10)), trip("2026-11-25", at(17, 15))];
  assert.equal(firstShopFirst("2026-11-21", "2026-11-21", weekend, at(8))[0].date, "2026-11-21");
  // Past 10:00 on Saturday it would be missed already, and tomorrow is its own day: it stays there.
  assert.deepEqual(firstShopFirst("2026-11-21", "2026-11-21", weekend, at(11)), weekend);

  // The same week planned on Monday, with only Wednesday's shop left.
  const midweek = [trip("2026-11-25", at(17, 15))];
  assert.equal(firstShopFirst("2026-11-21", "2026-11-23", midweek, at(9))[0].date, "2026-11-23");
  // At 18:00 on Monday its time today has gone: it goes on Tuesday, and stays there.
  const evening = firstShopFirst("2026-11-21", "2026-11-23", midweek, at(18));
  assert.deepEqual(evening, [{ ...midweek[0], date: "2026-11-24", moved: true }]);
  assert.deepEqual(firstShopFirst("2026-11-21", "2026-11-23", evening), evening);
});

test("a shop done today stays done, and the new plan's later shop that day stays too, under its own id", () => {
  const done: Trip = { id: "trip-2026-11-24", date: "2026-11-24", start: at(9), doneOn: "2026-11-24" };
  const later: Trip = { id: "trip-2026-11-24", date: "2026-11-24", start: at(17, 15) };
  const earlier: Trip = { id: "trip-2026-11-24", date: "2026-11-24", start: at(8) };
  const wednesday: Trip = { id: "trip-2026-11-25", date: "2026-11-25", start: at(17, 15) };
  assert.deepEqual(withDoneShops([done], [later, wednesday]), [done, { ...later, id: "trip-2026-11-24-2" }, wednesday]);
  // One at or before the done shop's time that day is the shop that's done.
  assert.deepEqual(withDoneShops([done], [earlier, wednesday]), [done, wednesday]);
  // Shops not done are the new plan's to replace.
  assert.deepEqual(withDoneShops([{ ...done, doneOn: undefined }], [wednesday]), [wednesday]);
  assert.deepEqual(withDoneShops(undefined, [wednesday]), [wednesday]);
});

test("a fresh week planned on Tuesday evening has no cook or shop at a time already gone", () => {
  const evening = suggestWeek(profile, START, [], {}, {}, "2026-11-17", "fresh", undefined, undefined, at(20));
  const later = (x: { date: string; start: number }) =>
    x.date > "2026-11-17" || (x.date === "2026-11-17" && x.start >= at(20));
  assert.ok(evening.cooks.length > 0);
  assert.ok(evening.cooks.every(later), when(evening.cooks).join(", "));
  assert.ok((evening.trips ?? []).every(later), when(evening.trips ?? []).join(", "));
  assert.equal(evening.cooks[0].date, "2026-11-18");

  // Planned at noon instead, the catch-up cook is tonight, with a shop before it.
  const noon = suggestWeek(profile, START, [], {}, {}, "2026-11-17", "fresh", undefined, undefined, at(12));
  assert.equal(`${noon.cooks[0].date} ${noon.cooks[0].start}`, `2026-11-17 ${at(18)}`);
  assert.deepEqual(when(noon.trips ?? [])[0], `2026-11-17 ${at(17, 15)}`);
});
