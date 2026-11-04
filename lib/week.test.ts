import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dateIn, midnightIn, weekOf, weekdayIndex } from "./week.ts";

test("dateIn uses the time zone's calendar date", () => {
  const instant = new Date("2026-11-04T23:30:00Z");
  assert.equal(dateIn(instant, "UTC"), "2026-11-04");
  assert.equal(dateIn(instant, "Asia/Tokyo"), "2026-11-05");
  assert.equal(dateIn(instant, "America/Los_Angeles"), "2026-11-04");
});

test("weekdayIndex counts from Monday", () => {
  assert.equal(weekdayIndex("2026-11-02"), 0);
  assert.equal(weekdayIndex("2026-11-08"), 6);
});

test("weekOf returns Monday to Sunday", () => {
  const week = weekOf(new Date("2026-11-04T12:00:00Z"), "UTC");
  assert.equal(week.start, "2026-11-02");
  assert.equal(week.end, "2026-11-08");
  assert.equal(week.startsAt.toISOString(), "2026-11-02T00:00:00.000Z");
  assert.equal(week.endsAt.toISOString(), "2026-11-09T00:00:00.000Z");
});

test("a Sunday belongs to the week that started the Monday before", () => {
  const week = weekOf(new Date("2026-11-08T21:00:00Z"), "UTC");
  assert.equal(week.start, "2026-11-02");
});

test("midnightIn handles zones ahead of and behind UTC", () => {
  assert.equal(midnightIn("2026-11-02", "Europe/London").toISOString(), "2026-11-02T00:00:00.000Z");
  assert.equal(midnightIn("2026-07-06", "Europe/London").toISOString(), "2026-07-05T23:00:00.000Z");
  assert.equal(midnightIn("2026-11-02", "America/New_York").toISOString(), "2026-11-02T05:00:00.000Z");
});

test("addDays crosses month ends", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
});

test("zonedInstant and zonedParts round-trip wall-clock times", async () => {
  const { zonedInstant, zonedParts, clock, parseClock } = await import("./week.ts");
  const instant = zonedInstant("2026-07-06", 9 * 60 + 30, "Europe/London");
  assert.equal(instant.toISOString(), "2026-07-06T08:30:00.000Z");
  assert.deepEqual(zonedParts(instant, "Europe/London"), { date: "2026-07-06", minutes: 570 });
  assert.deepEqual(zonedParts(new Date("2026-11-04T23:30:00Z"), "Asia/Tokyo"), { date: "2026-11-05", minutes: 510 });
  assert.equal(clock(570), "09:30");
  assert.equal(parseClock("9:30"), 570);
  assert.equal(parseClock("24:00"), null);
});
