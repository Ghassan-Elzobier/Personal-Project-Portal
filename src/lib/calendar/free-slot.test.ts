import { test } from "node:test";
import assert from "node:assert/strict";
import { MORNING, nextFreeSlot, overlaps, type Taken } from "./free-slot.ts";
import { LATEST_START, placeShort } from "./free-slot.ts";

// Made-up days. Minutes after midnight: 9 * 60 is 09:00.
const TODAY = "2026-11-16";
const TOMORROW = "2026-11-17";
const at = (h: number, m = 0) => h * 60 + m;
const block = (date: string, from: number, to: number): Taken => ({ date, start: from, end: to });

test("two stretches overlap only when they share time: touching ends don't", () => {
  assert.equal(overlaps(at(9), at(10), at(9, 30), at(11)), true);
  assert.equal(overlaps(at(9), at(10), at(10), at(11)), false);
  assert.equal(overlaps(at(9), at(10), at(8), at(9)), false);
  assert.equal(overlaps(at(9), at(10), at(9, 15), at(9, 45)), true);
});

test("the first free time is now, rounded up to the quarter hour", () => {
  assert.deepEqual(nextFreeSlot([], TODAY, at(9, 30), 60), { date: TODAY, start: at(9, 30) });
  assert.deepEqual(nextFreeSlot([], TODAY, at(9, 31), 60), { date: TODAY, start: at(9, 45) });
  assert.deepEqual(nextFreeSlot([], TODAY, at(9, 59), 60), { date: TODAY, start: at(10) });
});

test("it skips whatever is in the way, and takes the first gap the whole block fits in", () => {
  const taken = [
    block(TODAY, at(7), at(8)), // the missed block itself, already gone
    block(TODAY, at(10), at(11)),
    block(TODAY, at(11, 30), at(12, 30)),
    block(TODAY, at(13), at(14)),
  ];
  // Half an hour fits before 10:00.
  assert.deepEqual(nextFreeSlot(taken, TODAY, at(9, 20), 30), { date: TODAY, start: at(9, 30) });
  // An hour doesn't fit before 10:00, nor in the half hours at 11:00 and 12:30: it goes after 14:00.
  assert.deepEqual(nextFreeSlot(taken, TODAY, at(9, 20), 60), { date: TODAY, start: at(14) });
  // Other days' blocks are not in the way.
  assert.deepEqual(nextFreeSlot([block(TOMORROW, at(9), at(23))], TODAY, at(9, 20), 60), {
    date: TODAY,
    start: at(9, 30),
  });
});

test("a block keeps its length: it is never offered a time that would run past midnight", () => {
  assert.deepEqual(nextFreeSlot([], TODAY, at(22), 120), { date: TODAY, start: at(22) });
  assert.equal(nextFreeSlot([], TODAY, at(22, 15), 120), null);
  assert.deepEqual(nextFreeSlot([], TODAY, at(22, 15), 120, TOMORROW), { date: TOMORROW, start: MORNING });
});

test("when today is full, tomorrow is offered from the morning, around what is planned there", () => {
  const full = [block(TODAY, at(9), at(24)), block(TOMORROW, at(6), at(7)), block(TOMORROW, at(9), at(10, 30))];
  assert.deepEqual(nextFreeSlot(full, TODAY, at(9, 30), 60, TOMORROW), { date: TOMORROW, start: at(10, 30) });
  assert.equal(nextFreeSlot(full, TODAY, at(9, 30), 60), null, "tomorrow is not offered when its blocks are not known");
  const both = [block(TODAY, at(9), at(24)), block(TOMORROW, at(8), at(24))];
  assert.equal(nextFreeSlot(both, TODAY, at(9, 30), 60, TOMORROW), null);
});

test("a block with no length has nowhere to go", () => {
  assert.equal(nextFreeSlot([], TODAY, at(9), 0, TOMORROW), null);
});

// The week of the made-up Monday above.
const WEEK = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
const [MON, TUE, WED, THU, FRI, SAT, SUN] = WEEK;
const wholeDay = (date: string) => block(date, 0, at(24));

test("the hours still short are offered an hour at a time on different days, clear of what is taken", () => {
  // Only Tuesday and Thursday have room; Tuesday's morning is taken.
  const taken = [MON, WED, FRI, SAT, SUN].map(wholeDay).concat(block(TUE, at(9), at(12)), block(THU, at(9), at(9, 30)));
  const offers = placeShort({ taken, days: WEEK, today: MON, now: at(9, 30), short: 120 });
  assert.deepEqual(offers, [
    { date: TUE, start: at(12), duration: 60 },
    { date: THU, start: at(9, 30), duration: 60 },
  ]);
  for (const o of offers) {
    assert.ok(o.start <= LATEST_START, "nothing starts after 22:00");
    assert.ok(!taken.some((t) => t.date === o.date && overlaps(o.start, o.start + o.duration, t.start, t.end)));
  }
  assert.equal(new Set(offers.map((o) => o.date)).size, offers.length, "one a day");
});

test("with no free time in the week, nothing is offered", () => {
  assert.deepEqual(placeShort({ taken: WEEK.map(wholeDay), days: WEEK, today: MON, now: at(9, 30), short: 120 }), []);
});

test("a day whose only room starts after 22:00 is passed over", () => {
  const taken = [MON, TUE, THU, FRI, SAT, SUN].map(wholeDay).concat(block(WED, 0, at(22, 15)));
  assert.deepEqual(placeShort({ taken, days: WEEK, today: MON, now: at(9, 30), short: 60 }), []);
});

test("today is offered from now, past days not at all, and the last block is only as long as what is left", () => {
  const offers = placeShort({ taken: [], days: WEEK, today: WED, now: at(18, 10), short: 80 });
  assert.deepEqual(offers, [
    { date: WED, start: at(18, 15), duration: 60 },
    { date: THU, start: MORNING, duration: 30 },
  ]);
});

test("at most three times are offered, however short the week is", () => {
  const offers = placeShort({ taken: [], days: WEEK, today: MON, now: at(9, 30), short: 600 });
  assert.equal(offers.length, 3);
  assert.deepEqual(
    offers.map((o) => o.date),
    [MON, TUE, WED],
  );
});

test("nothing is offered when the week is not short", () => {
  assert.deepEqual(placeShort({ taken: [], days: WEEK, today: MON, now: at(9, 30), short: 0 }), []);
});
