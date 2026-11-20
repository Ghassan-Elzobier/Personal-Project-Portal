import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewsFor } from "./reviews.ts";

// A recall card can carry its answer, so the owner checks against it before rating.
// Beside reviews.test.ts, which covers the cards themselves. Made-up questions.

test("a chosen prompt keeps the answer the tutor gave with it", () => {
  const out = reviewsFor({
    chosen: [{ prompt: "Why does tiling cut global reads?", answer: "A tile is loaded once and reused by the block." }],
    misses: [],
  });
  assert.deepEqual(out, [
    {
      prompt: "Why does tiling cut global reads?",
      days: 3,
      answer: "A tile is loaded once and reused by the block.",
    },
  ]);
});

test("a missed check carries the feedback recorded for it as its answer", () => {
  const out = reviewsFor({
    chosen: [],
    misses: [{ question: "What limits the kernel?", feedback: "Memory bandwidth, not arithmetic." }],
  });
  assert.deepEqual(out, [
    { prompt: "From memory: What limits the kernel?", days: 1, answer: "Memory bandwidth, not arithmetic." },
  ]);
});

test("a card with nothing to check against has no answer at all", () => {
  const out = reviewsFor({
    chosen: [{ prompt: "No answer given" }, { prompt: "A blank one", answer: "   " }],
    misses: [{ question: "Missed, with no feedback", feedback: "" }, { question: "Missed, feedback left out" }],
  });
  assert.deepEqual(out, [
    { prompt: "From memory: Missed, with no feedback", days: 1 },
    { prompt: "From memory: Missed, feedback left out", days: 1 },
    { prompt: "No answer given", days: 3 },
    { prompt: "A blank one", days: 3 },
  ]);
  for (const review of out) assert.equal("answer" in review, false, review.prompt);
});

test("an answer is tidied but keeps its lines, and is clipped to what a card holds", () => {
  const [tidy] = reviewsFor({
    chosen: [{ prompt: "Tidy?", answer: "  Loaded   once,\r\n reused by the block. \n\n\n\n So fewer reads.  " }],
    misses: [],
  });
  assert.equal(tidy.answer, "Loaded once,\nreused by the block.\n\nSo fewer reads.");
  const [long] = reviewsFor({ chosen: [{ prompt: "Long?", answer: "x".repeat(1500) }], misses: [] });
  assert.equal(long.answer?.length, 1000);
  assert.equal(long.answer?.endsWith("…"), true);
  const [fits] = reviewsFor({ chosen: [{ prompt: "Fits?", answer: "x".repeat(1000) }], misses: [] });
  assert.equal(fits.answer, "x".repeat(1000));
});

test("a miss still comes first, and when Claude also chose the same question the miss's card is the one kept", () => {
  const out = reviewsFor({
    chosen: [{ prompt: "from memory: what limits the kernel?", answer: "Claude's own wording." }],
    misses: [{ question: "What limits the kernel?", feedback: "Memory bandwidth." }],
  });
  assert.deepEqual(out, [{ prompt: "From memory: What limits the kernel?", days: 1, answer: "Memory bandwidth." }]);
});

test("misses given as plain questions still work, with no answer", () => {
  assert.deepEqual(reviewsFor({ chosen: [], misses: ["What is a warp?"] }), [
    { prompt: "From memory: What is a warp?", days: 1 },
  ]);
});
