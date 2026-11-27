import assert from "node:assert/strict";
import test from "node:test";
import { applyBy } from "./next-step.ts";

test("a role that closes gets the step to apply by the day before", () => {
  assert.deepEqual(applyBy("2026-11-30", "2026-11-16"), {
    next_action: "Apply, closes 30 Nov",
    next_action_on: "2026-11-29",
  });
});

test("a role that closes today or tomorrow is due today", () => {
  assert.equal(applyBy("2026-11-16", "2026-11-16")?.next_action_on, "2026-11-16");
  assert.equal(applyBy("2026-11-17", "2026-11-16")?.next_action_on, "2026-11-16");
});

test("a role that has already closed gets no step", () => {
  assert.equal(applyBy("2026-11-15", "2026-11-16"), null);
});
