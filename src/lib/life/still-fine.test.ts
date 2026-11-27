import { test } from "node:test";
import assert from "node:assert/strict";
import { asLeftover, fineUntilProblem, fridgeEatBy, leftoversFor, nextFineUntil } from "./leftovers.ts";
import { assign, fillGaps, type Placement, type Routine, type StockBatch, type WeekPlan } from "./planner.ts";
import { recipe } from "./recipes.ts";

// "Still fine until": the owner's own call that one fridge batch is fine past its
// Food Standards Agency eat-by, for at most two days more. Made-up data: a traybake
// (two days in the fridge, doesn't freeze) cooked on Sunday 15 Nov 2026, in a week
// with no cooks, so its meals come from that batch or show nothing planned.

const KEEPS = recipe("batata-traybake")!.keeps;
const COOKED = "2026-11-15";
const routine: Routine = { breakfast: 360, lunch: 750, shake: 960, dinner: 1140, maxRepeat: 7, lunchAtWork: false };
const week: WeekPlan = {
  start: "2026-11-15",
  cooks: [],
  breakfast: "bagel-ham",
  shake: "raspberry-shake",
  fresh: [],
  out: [],
};
const batch = (fineUntil?: string | null): StockBatch => ({
  gid: "x",
  recipe: "batata-traybake",
  cookedOn: COOKED,
  left: 14,
  location: "fridge",
  scale: 1,
  ...(fineUntil !== undefined ? { fineUntil } : {}),
});
/** The last day a lunch or dinner is planned from the batch. */
const lastDay = (placed: Placement[]) =>
  placed
    .filter((p) => p.batchGid === "x")
    .map((p) => p.date)
    .sort()
    .at(-1);

test("the eat-by is the rule's until the owner sets a day, and that day stands in for it", () => {
  assert.equal(fridgeEatBy(COOKED, KEEPS, null), "2026-11-17");
  assert.equal(fridgeEatBy(COOKED, KEEPS, undefined), "2026-11-17");
  assert.equal(fridgeEatBy(COOKED, KEEPS, "2026-11-19"), "2026-11-19");
  const b = { gid: "x", remaining: 2, location: "fridge" as const, cookedOn: COOKED };
  assert.equal(asLeftover(b, recipe("batata-traybake")!).eatBy, "2026-11-17");
  assert.equal(asLeftover(b, recipe("batata-traybake")!).ownCall, false);
  const kept = asLeftover({ ...b, fineUntil: "2026-11-18" }, recipe("batata-traybake")!);
  assert.equal(kept.eatBy, "2026-11-18");
  assert.equal(kept.ownCall, true);
  // The freezer has no eat-by, whatever was set.
  assert.equal(
    asLeftover({ ...b, location: "freezer", fineUntil: "2026-11-18" }, recipe("batata-traybake")!).eatBy,
    null,
  );
});

test("the day must be after the rule's eat-by and at most two days past it", () => {
  assert.match(fineUntilProblem(COOKED, KEEPS, "2026-11-17") ?? "", /anyway/);
  assert.equal(fineUntilProblem(COOKED, KEEPS, "2026-11-18"), null);
  assert.equal(fineUntilProblem(COOKED, KEEPS, "2026-11-19"), null);
  assert.match(fineUntilProblem(COOKED, KEEPS, "2026-11-20") ?? "", /two days/);
});

test("the Kitchen offers one day more at a time, never before today, and stops at two days past", () => {
  assert.equal(nextFineUntil(COOKED, KEEPS, null, "2026-11-17"), "2026-11-18");
  assert.equal(nextFineUntil(COOKED, KEEPS, "2026-11-18", "2026-11-17"), "2026-11-19");
  assert.equal(nextFineUntil(COOKED, KEEPS, "2026-11-19", "2026-11-17"), null);
  // Already past its eat-by: today, while that is within two days of it.
  assert.equal(nextFineUntil(COOKED, KEEPS, null, "2026-11-19"), "2026-11-19");
  assert.equal(nextFineUntil(COOKED, KEEPS, null, "2026-11-20"), null);
});

test("leftovers can be eaten from the batch up to the owner's day, and no later", () => {
  const b = { gid: "x", remaining: 2, location: "fridge" as const, cookedOn: COOKED };
  const r = recipe("batata-traybake")!;
  assert.equal(leftoversFor([asLeftover(b, r)], "2026-11-18", "dinner", null).length, 0);
  const kept = asLeftover({ ...b, fineUntil: "2026-11-18" }, r);
  assert.equal(leftoversFor([kept], "2026-11-18", "dinner", null).length, 1);
  assert.equal(leftoversFor([kept], "2026-11-19", "dinner", null).length, 0);
});

test("the week plans lunches and dinners from the batch up to the owner's day, then nothing", () => {
  const rule = assign(week, routine, [batch()], 2600);
  assert.equal(lastDay(rule), "2026-11-17");
  const kept = assign(week, routine, [batch("2026-11-19")], 2600);
  assert.equal(lastDay(kept), "2026-11-19");
  const after = kept.filter((p) => p.date === "2026-11-20" && (p.slot === "lunch" || p.slot === "dinner"));
  assert.ok(after.every((p) => p.source === "none"));
  assert.ok(kept.filter((p) => p.batchGid === "x").every((p) => p.storage === "fridge"));
});

test("a batch with no day set plans exactly as before", () => {
  assert.deepEqual(assign(week, routine, [batch(null)], 2600), assign(week, routine, [batch()], 2600));
});

test("empty meals left by a skipped meal fill from the batch up to the owner's day", () => {
  const empty = assign(week, routine, [], 2600);
  const rule = fillGaps(empty, [batch()], "2026-11-15");
  assert.equal(lastDay(rule), "2026-11-17");
  const kept = fillGaps(empty, [batch("2026-11-18")], "2026-11-15");
  assert.equal(lastDay(kept), "2026-11-18");
  assert.deepEqual(fillGaps(empty, [batch(null)], "2026-11-15"), rule);
});
