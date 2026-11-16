import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, summarize } from "./stats.ts";

const a = (correct: boolean | null, confidence: number | null, dontKnow = false) => ({ correct, confidence, dontKnow });

test("accuracy counts only answers that were marked", () => {
  const s = summarize([a(true, 90), a(false, 40), a(null, null), a(true, 60)]);
  assert.equal(s.answers, 4);
  assert.equal(s.checked, 3);
  assert.equal(s.correct, 2);
  assert.ok(Math.abs((s.accuracy ?? 0) - 2 / 3) < 1e-9);
});

test("a wrong answer given at 70 or more is a confident miss", () => {
  const s = summarize([a(false, 70), a(false, 69), a(false, 95), a(true, 99)]);
  assert.equal(s.confidentMisses, 2);
});

test("calibration compares average confidence with accuracy", () => {
  const s = summarize([a(true, 80), a(false, 80), a(true, 60), a(false, 60)]);
  assert.ok(s.calibration);
  assert.ok(Math.abs(s.calibration.confidence - 0.7) < 1e-9);
  assert.equal(s.calibration.accuracy, 0.5);
});

test("an empty session has no accuracy and no calibration", () => {
  const s = summarize([]);
  assert.equal(s.accuracy, null);
  assert.equal(s.calibration, null);
  assert.equal(describe(s), null);
});

test("don't knows are counted and carry no calibration", () => {
  const s = summarize([a(null, null, true), a(false, null, true)]);
  assert.equal(s.dontKnow, 2);
  assert.equal(s.calibration, null);
});

test("the summary reads in plain words", () => {
  assert.equal(describe({ checked: 4, correct: 3, confidentMisses: 1 }), "3 of 4 right, 1 sure but wrong");
  assert.equal(describe({ checked: 2, correct: 2, confidentMisses: 0 }), "2 of 2 right");
});
