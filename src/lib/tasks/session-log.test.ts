import { test } from "node:test";
import assert from "node:assert/strict";
import { addHours, parseSessionForm, sessionComment, sessionHours, statusDraft } from "./session-log.ts";

test("parseSessionForm accepts a normal session", () => {
  const result = parseSessionForm({ hours: "1.5", stage: "In progress", evidence: "https://github.com/x/y/commit/abc", notes: " read 3.2 " });
  assert.deepEqual(result, {
    ok: true,
    value: { hours: 1.5, stage: "In progress", evidence: "https://github.com/x/y/commit/abc", notes: "read 3.2" },
  });
});

test("parseSessionForm rejects bad hours, stages and links", () => {
  assert.equal(parseSessionForm({ hours: "0" }).ok, false);
  assert.equal(parseSessionForm({ hours: "17" }).ok, false);
  assert.equal(parseSessionForm({ hours: "1.1" }).ok, false);
  assert.equal(parseSessionForm({ hours: "abc" }).ok, false);
  assert.equal(parseSessionForm({ hours: "1", stage: "Finished" }).ok, false);
  assert.equal(parseSessionForm({ hours: "1", evidence: "javascript:alert(1)" }).ok, false);
  assert.equal(parseSessionForm({ hours: "1", evidence: "not a link" }).ok, false);
});

test("a session comment round-trips its hours", () => {
  const text = sessionComment({ hours: 2.25, stage: "Done", evidence: "https://example.com", notes: "Finished." });
  assert.equal(text.split("\n")[0], "Session log · 2.25 h");
  assert.equal(sessionHours(text), 2.25);
  assert.equal(sessionHours("A normal comment"), null);
  assert.equal(sessionHours(null), null);
});

test("addHours avoids float drift", () => {
  assert.equal(addHours(0.1, 0.2), 0.3);
  assert.equal(addHours(null, 1.5), 1.5);
});

test("statusDraft follows the template and never leaves questions empty", () => {
  const text = statusDraft({
    status: "on_track",
    done: [{ name: "Finish PMPP ch. 3 exercises", hours: 6, evidence: "https://example.com/c" }],
    next: ["PMPP ch. 4"],
    blocked: [],
    hours: 9,
    target: 10,
  });
  assert.equal(
    text,
    [
      "Status: On track",
      "Done this week: Finish PMPP ch. 3 exercises (6 h) https://example.com/c",
      "Next week: PMPP ch. 4",
      "Blocked / questions for you: None",
      "Hours this week: 9 of 10 planned",
    ].join("\n"),
  );
});
