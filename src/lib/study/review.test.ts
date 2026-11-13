import { test } from "node:test";
import assert from "node:assert/strict";
import { gapLabel, nextExerciseStatus, nextReview, spreadDates, tallyExercises } from "./review.ts";

const today = "2026-11-05";

test("getting it right spaces the next review further out", () => {
  assert.deepEqual(nextReview({ step: 0, kind: "result", rating: "got", today }), {
    step: 1,
    dueOn: "2026-11-08",
    retire: false,
  });
  assert.deepEqual(nextReview({ step: 2, kind: "result", rating: "got", today }), {
    step: 3,
    dueOn: "2026-11-19",
    retire: false,
  });
});

test("shaky repeats the same gap and missed starts again", () => {
  assert.deepEqual(nextReview({ step: 2, kind: "result", rating: "shaky", today }), {
    step: 2,
    dueOn: "2026-11-12",
    retire: false,
  });
  assert.deepEqual(nextReview({ step: 5, kind: "result", rating: "missed", today }), {
    step: 0,
    dueOn: "2026-11-06",
    retire: false,
  });
});

test("a redone exercise retires sooner than a theorem", () => {
  assert.equal(nextReview({ step: 3, kind: "exercise", rating: "got", today }).retire, true);
  assert.equal(nextReview({ step: 3, kind: "result", rating: "got", today }).retire, false);
  assert.equal(nextReview({ step: 6, kind: "result", rating: "got", today }).retire, true);
});

test("gapLabel uses plain words", () => {
  assert.equal(gapLabel(today, "2026-11-06"), "tomorrow");
  assert.equal(gapLabel(today, "2026-11-12"), "in 7 days");
  assert.equal(gapLabel(today, null), "done with this");
});

test("spreadDates paces units evenly and finishes on the last slot", () => {
  const dates = spreadDates(["a", "b", "c", "d"], "2026-11-05", 2).map((d) => d.dueOn);
  assert.deepEqual(dates, ["2026-11-08", "2026-11-11", "2026-11-15", "2026-11-18"]);
  assert.deepEqual(
    spreadDates(["a"], "2026-11-05", 7).map((d) => d.dueOn),
    ["2026-11-05"],
  );
  assert.deepEqual(spreadDates([], "2026-11-05", 3), []);
});

test("spreadDates at one a week falls due weekly", () => {
  assert.deepEqual(
    spreadDates(["a", "b"], "2026-11-05", 1).map((d) => d.dueOn),
    ["2026-11-11", "2026-11-18"],
  );
});

test("a tap moves an exercise through every state and back", () => {
  assert.equal(nextExerciseStatus(null), "solved");
  assert.equal(nextExerciseStatus("solved"), "hint");
  assert.equal(nextExerciseStatus("hint"), "stuck");
  assert.equal(nextExerciseStatus("stuck"), "skip");
  assert.equal(nextExerciseStatus("skip"), null);
});

test("tallyExercises counts each state", () => {
  assert.deepEqual(tallyExercises(["solved", "solved", "stuck", "skip"]), { solved: 2, hint: 0, stuck: 1, skip: 1 });
});
