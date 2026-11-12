import { test } from "node:test";
import assert from "node:assert/strict";
import { adjust, bmr, BULK, targetsFor, trend, weeklyRate, type Weight } from "./nutrition.ts";
import { addDays } from "../dates/week.ts";

test("Mifflin-St Jeor resting energy", () => {
  // 10 × 70 + 6.25 × 180 − 5 × 30 + 5
  assert.equal(bmr({ sex: "male", age: 30, heightCm: 180, kg: 70 }), 1680);
  assert.equal(bmr({ sex: "female", age: 30, heightCm: 165, kg: 60 }), 1320.25);
});

test("bulk targets: surplus on top of maintenance, protein by weight, fat a quarter", () => {
  const t = targetsFor({ sex: "male", age: 30, heightCm: 180, kg: 70 }, BULK, 1.5);
  // 1680 × 1.5 = 2520, plus 0.4% × 70 × 5500 / 7 = 220
  assert.equal(t.kcal, 2750);
  assert.equal(t.protein, 140);
  assert.ok(Math.abs(t.fat * 9 - t.kcal * 0.25) < 50);
  assert.ok(t.carbs > 300);
  assert.equal(targetsFor({ sex: "male", age: 30, heightCm: 180, kg: 70 }, BULK, 1.5, 3000).maintenance, 3000);
});

const series = (start: string, kgs: number[]): Weight[] => kgs.map((kg, i) => ({ day: addDays(start, i), kg }));

test("the trend barely moves on one heavy day", () => {
  const t = trend(series("2026-11-01", [70, 70, 70, 71.5, 70]));
  assert.ok(t[3].trend < 70.2);
  assert.ok(t[4].trend > 70);
});

test("weekly rate from a steady gain, and none from too few points", () => {
  const gain = series("2026-11-01", Array.from({ length: 21 }, (_, i) => 65 + (0.3 / 7) * i));
  const rate = weeklyRate(gain, "2026-11-21");
  assert.ok(rate !== null && Math.abs(rate - 0.3) < 0.01);
  assert.equal(weeklyRate(gain.slice(0, 5), "2026-11-05"), null);
});

test("the target waits two weeks, then nudges up by at most 150 kcal", () => {
  const flat = series("2026-11-01", Array.from({ length: 21 }, () => 65));
  assert.equal(adjust(flat, "2026-11-10", 65, BULK, 1, "2026-11-01").change, 0);
  const a = adjust(flat, "2026-11-21", 65, BULK, 1, "2026-11-01");
  assert.equal(a.change, 150);
  const fast = series("2026-11-01", Array.from({ length: 21 }, (_, i) => 65 + (1 / 7) * i));
  assert.equal(adjust(fast, "2026-11-21", 65, BULK, 1, "2026-11-01").change, -150);
});

test("eating under plan is named before the target goes up", () => {
  const flat = series("2026-11-01", Array.from({ length: 21 }, () => 65));
  const a = adjust(flat, "2026-11-21", 65, BULK, 0.7, "2026-11-01");
  assert.equal(a.change, 0);
  assert.match(a.why, /70%/);
});
