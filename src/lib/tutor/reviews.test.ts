import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewsFor } from "./reviews.ts";

test("a missed check comes back tomorrow, a chosen claim in three days", () => {
  const out = reviewsFor({
    chosen: [{ prompt: "Why does tiling cut global reads?" }],
    misses: ["What limits the kernel?"],
  });
  assert.deepEqual(out, [
    { prompt: "From memory: What limits the kernel?", days: 1 },
    { prompt: "Why does tiling cut global reads?", days: 3 },
  ]);
});

test("repeats are added once, ignoring case and spacing", () => {
  const out = reviewsFor({
    chosen: [{ prompt: "Why   tile?" }, { prompt: "why tile?" }],
    misses: [],
  });
  assert.equal(out.length, 1);
});

test("days stay between 1 and 30", () => {
  const out = reviewsFor({
    chosen: [
      { prompt: "a", days: 0 },
      { prompt: "b", days: 900 },
    ],
    misses: [],
  });
  assert.deepEqual(
    out.map((r) => r.days),
    [1, 30],
  );
});

test("long prompts are clipped to the queue's limit", () => {
  const [review] = reviewsFor({ chosen: [{ prompt: "x".repeat(900) }], misses: [] });
  assert.equal(review.prompt.length, 500);
});

test("at most ten are added, and misses are kept ahead of keepsakes", () => {
  const out = reviewsFor({
    chosen: Array.from({ length: 12 }, (_, i) => ({ prompt: `claim ${i}` })),
    misses: ["m1", "m2"],
  });
  assert.equal(out.length, 10);
  assert.equal(out[0].prompt, "From memory: m1");
  assert.equal(out[1].prompt, "From memory: m2");
});

test("blank prompts are skipped", () => {
  assert.deepEqual(reviewsFor({ chosen: [{ prompt: "   " }], misses: [""] }).length, 1);
});
