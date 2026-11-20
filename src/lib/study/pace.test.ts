import { test } from "node:test";
import assert from "node:assert/strict";
import { paceOn, savedAs, weekTarget, type Pace } from "./pace.ts";

// The pace set on the Study page is what a week of study is counted against, and
// what the pace form opens on. Weeks run Monday to Sunday; 16 November 2026 is a Monday.

const steady: Pace = { hoursPerWeek: 37 };
// 1 December 2026 is a Tuesday: the week of Monday 30 November holds the change.
const changing: Pace = { hoursPerWeek: 37, until: "2026-12-01", thenHoursPerWeek: 18 };

test("a pace with no change is every week's target", () => {
  assert.equal(weekTarget(steady, "2026-11-16"), 37);
  assert.equal(weekTarget(steady, "2027-06-07"), 37);
});

test("a week before the change counts against the first pace", () => {
  assert.equal(weekTarget(changing, "2026-11-16"), 37);
  assert.equal(weekTarget(changing, "2026-11-23"), 37, "the week that ends the Sunday before the change");
});

test("the week that holds the change, and every week after it, counts against the later pace", () => {
  assert.equal(weekTarget(changing, "2026-11-30"), 18, "the change is on this week's Tuesday");
  assert.equal(weekTarget(changing, "2026-12-07"), 18);
  assert.equal(weekTarget(changing, "2027-03-01"), 18);
});

test("a change on a Monday starts that week, and one on a Sunday still counts for its week", () => {
  const monday: Pace = { hoursPerWeek: 30, until: "2026-11-30", thenHoursPerWeek: 10 };
  assert.equal(weekTarget(monday, "2026-11-23"), 30);
  assert.equal(weekTarget(monday, "2026-11-30"), 10);
  const sunday: Pace = { hoursPerWeek: 30, until: "2026-12-06", thenHoursPerWeek: 10 };
  assert.equal(weekTarget(sunday, "2026-11-23"), 30);
  assert.equal(weekTarget(sunday, "2026-11-30"), 10);
});

test("half a change is no change: a day with no hours, or hours with no day", () => {
  assert.equal(weekTarget({ hoursPerWeek: 25, until: "2026-11-01" }, "2026-11-16"), 25);
  assert.equal(weekTarget({ hoursPerWeek: 25, thenHoursPerWeek: 5 }, "2026-11-16"), 25);
});

test("the form opens on the pace as set while the change is still to come", () => {
  assert.deepEqual(paceOn(changing, "2026-11-16"), changing);
  assert.deepEqual(paceOn(changing, "2026-11-30"), changing, "the day before the change");
  assert.deepEqual(paceOn(steady, "2026-11-16"), steady);
});

test("once the change has come, the later hours are the pace and no change is left to show", () => {
  assert.deepEqual(paceOn(changing, "2026-12-01"), { hoursPerWeek: 18 }, "the day of the change");
  assert.deepEqual(paceOn(changing, "2027-01-04"), { hoursPerWeek: 18 });
  assert.deepEqual(paceOn({ hoursPerWeek: 25, until: "2026-11-01" }, "2026-11-16"), { hoursPerWeek: 25 });
});

test("a pace is saved with its start, and with a change only when the change comes after the start", () => {
  assert.deepEqual(savedAs(37, "2026-11-16"), { start: "2026-11-16", hoursPerWeek: 37 });
  assert.deepEqual(savedAs(37, "2026-11-16", { from: "2026-12-01", hoursPerWeek: 18 }), {
    start: "2026-11-16",
    hoursPerWeek: 37,
    until: "2026-12-01",
    thenHoursPerWeek: 18,
  });
  // The dates are worked out with such a change left out (dayAfterHours), so it is not saved either.
  assert.deepEqual(savedAs(37, "2026-11-16", { from: "2026-11-16", hoursPerWeek: 18 }), {
    start: "2026-11-16",
    hoursPerWeek: 37,
  });
  assert.deepEqual(savedAs(37, "2026-11-16", { from: "2026-11-02", hoursPerWeek: 18 }), {
    start: "2026-11-16",
    hoursPerWeek: 37,
  });
});
