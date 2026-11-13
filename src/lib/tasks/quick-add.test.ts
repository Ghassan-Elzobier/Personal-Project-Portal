import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickAdd, pastedLines } from "./quick-add.ts";

// 2026-11-04 is a Wednesday.
const today = "2026-11-04";

test("reads a project tag anywhere and a date at the end", () => {
  assert.deepEqual(parseQuickAdd("Read chapter 5 #axler fri", today), {
    name: "Read chapter 5",
    project: "axler",
    dueOn: "2026-11-06",
  });
  assert.deepEqual(parseQuickAdd("#pmpp CUDA kernels tomorrow", today), {
    name: "CUDA kernels",
    project: "pmpp",
    dueOn: "2026-11-05",
  });
});

test("leaves dates in the middle of a name alone", () => {
  assert.deepEqual(parseQuickAdd("Friday review notes", today), {
    name: "Friday review notes",
    project: null,
    dueOn: null,
  });
});

test("a lone date word is a task name, not an empty task", () => {
  assert.deepEqual(parseQuickAdd("tomorrow", today), { name: "tomorrow", project: null, dueOn: null });
});

test("a weekday means the next one, never today", () => {
  assert.equal(parseQuickAdd("x wed", today).dueOn, "2026-11-11");
  assert.equal(parseQuickAdd("x thu", today).dueOn, "2026-11-05");
  assert.equal(parseQuickAdd("x next thu", today).dueOn, "2026-11-12");
  assert.equal(parseQuickAdd("x sunday", today).dueOn, "2026-11-08");
});

test("reads day and month in either order, rolling past dates to next year", () => {
  assert.equal(parseQuickAdd("x 20 nov", today).dueOn, "2026-11-20");
  assert.equal(parseQuickAdd("x nov 20", today).dueOn, "2026-11-20");
  assert.equal(parseQuickAdd("x 1 jan", today).dueOn, "2027-01-01");
  assert.equal(parseQuickAdd("x 2026-12-25", today).dueOn, "2026-12-25");
});

test("an impossible date stays part of the name", () => {
  assert.deepEqual(parseQuickAdd("x 31 feb", today), { name: "x 31 feb", project: null, dueOn: null });
  assert.equal(parseQuickAdd("x 2026-13-45", today).dueOn, null);
});

test("drops a linking due and keeps an unknown tag in the name", () => {
  assert.equal(parseQuickAdd("Essay due fri", today).name, "Essay");
  assert.equal(parseQuickAdd("Fix #123 today", today).name, "Fix #123");
});

test("pastedLines strips list markers and blank lines", () => {
  assert.deepEqual(pastedLines("1. Vector spaces\n\n- Linear maps\n* Eigenvalues\n[ ] Inner products\n 2) Duality "), [
    "Vector spaces",
    "Linear maps",
    "Eigenvalues",
    "Inner products",
    "Duality",
  ]);
});
