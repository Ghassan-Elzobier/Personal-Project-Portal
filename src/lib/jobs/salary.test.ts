import { test } from "node:test";
import assert from "node:assert/strict";
import { salaryOf } from "./salary.ts";

test("a salary in pounds becomes a yearly range in pence", () => {
  assert.deepEqual(salaryOf("£80K"), { minPence: 8_000_000, maxPence: 8_000_000 });
  assert.deepEqual(salaryOf("GBP 45000 to 55000"), { minPence: 4_500_000, maxPence: 5_500_000 });
  assert.deepEqual(salaryOf("£45k–£55k per annum + bonus"), { minPence: 4_500_000, maxPence: 5_500_000 });
  assert.deepEqual(salaryOf("Up to £60,000"), { minPence: 6_000_000, maxPence: 6_000_000 });
});

test("a day or hourly rate is worked out over a working year", () => {
  assert.deepEqual(salaryOf("£400 per day"), { minPence: 9_200_000, maxPence: 9_200_000 });
  assert.deepEqual(salaryOf("£25/hr"), { minPence: 4_875_000, maxPence: 4_875_000 });
});

test("another currency, no currency, or nothing like a salary gives nothing", () => {
  assert.equal(salaryOf("$120,000"), null);
  assert.equal(salaryOf("Competitive"), null);
  assert.equal(salaryOf("45000"), null);
  assert.equal(salaryOf(null), null);
  assert.equal(salaryOf("£ depending on experience"), null);
});
