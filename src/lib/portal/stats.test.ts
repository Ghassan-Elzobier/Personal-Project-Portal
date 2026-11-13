import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf } from "../dates/week.ts";
import { hoursByWeek, studyTotals, timerClock, timerHours } from "./stats.ts";

const tz = "Europe/London";
const now = new Date("2026-11-04T12:00:00Z");
const week = weekOf(now, tz);
const log = (h: number, at: string) => ({ text: `Session log · ${h} h\nNotes`, createdAt: at });

test("studyTotals adds today and this week and counts distinct days", () => {
  const totals = studyTotals(
    [
      log(1.5, "2026-11-04T09:00:00Z"),
      log(0.5, "2026-11-04T15:00:00Z"),
      log(2, "2026-11-02T09:00:00Z"),
      log(5, "2026-10-30T09:00:00Z"),
      { text: "A plain comment", createdAt: "2026-11-03T09:00:00Z" },
    ],
    week,
    "2026-11-04",
    tz,
  );
  assert.deepEqual(totals, { today: 2, week: 4, daysStudied: 2 });
});

test("studyTotals uses the portal's zone for the day", () => {
  // 23:30 UTC on a summer date is already the next day in London.
  const summer = weekOf(new Date("2026-07-15T12:00:00Z"), tz);
  const totals = studyTotals([log(1, "2026-07-14T23:30:00Z")], summer, "2026-07-15", tz);
  assert.equal(totals.today, 1);
});

test("hoursByWeek fills empty weeks and ignores older ones", () => {
  const weeks = hoursByWeek(
    [
      log(1, "2026-11-03T09:00:00Z"),
      log(2, "2026-11-04T09:00:00Z"),
      log(3, "2026-10-20T09:00:00Z"),
      log(9, "2026-01-01T09:00:00Z"),
    ],
    3,
    now,
    tz,
  );
  assert.deepEqual(weeks, [
    { start: "2026-10-19", hours: 3 },
    { start: "2026-10-26", hours: 0 },
    { start: "2026-11-02", hours: 3 },
  ]);
});

test("timerHours rounds to a quarter within the logging limits", () => {
  assert.equal(timerHours(60 * 1000), 0.25);
  assert.equal(timerHours(50 * 60 * 1000), 0.75);
  assert.equal(timerHours(53 * 60 * 1000), 1);
  assert.equal(timerHours(100 * 3600 * 1000), 16);
});

test("timerClock shows hours only when needed", () => {
  assert.equal(timerClock(65 * 1000), "01:05");
  assert.equal(timerClock(3725 * 1000), "1:02:05");
});
