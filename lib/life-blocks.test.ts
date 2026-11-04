import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlock, recurrence, wallClock } from "./life-blocks.ts";

test("recurrence builds the RRULE for each repeat choice", () => {
  assert.equal(recurrence("none", 2), undefined);
  assert.deepEqual(recurrence("daily", 2), ["RRULE:FREQ=DAILY"]);
  assert.deepEqual(recurrence("weekdays", 2), ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]);
  assert.deepEqual(recurrence("weekly", 6), ["RRULE:FREQ=WEEKLY;BYDAY=SU"]);
});

test("parseBlock accepts a normal block and rejects bad ones", () => {
  assert.deepEqual(parseBlock({ date: "2026-11-04", start: "780", duration: "45" }), {
    ok: true,
    value: { date: "2026-11-04", start: 780, duration: 45 },
  });
  assert.equal(parseBlock({ date: "Wednesday", start: 780, duration: 45 }).ok, false);
  assert.equal(parseBlock({ date: "2026-11-04", start: 781, duration: 45 }).ok, false);
  assert.equal(parseBlock({ date: "2026-11-04", start: 780, duration: 10 }).ok, false);
  assert.equal(parseBlock({ date: "2026-11-04", start: 1410, duration: 60 }).ok, false);
});

test("wallClock pads hours and minutes", () => {
  assert.equal(wallClock("2026-11-04", 545), "2026-11-04T09:05:00");
});
