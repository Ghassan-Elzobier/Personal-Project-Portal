import { test } from "node:test";
import assert from "node:assert/strict";
import { undoOf, type StockRow } from "./shopping.ts";

// Made-up kitchen: rice in the cupboard, salt low, oil never tracked, cumin already in.
const stock: StockRow[] = [
  { item: "rice", qty: 200, status: null, goodUntil: null },
  { item: "salt", qty: 0, status: "low", goodUntil: null },
  { item: "cumin", qty: 0, status: "have", goodUntil: null },
];

test("Undo after a shop takes its food back out and puts each staple back as it was", () => {
  const changes = [
    { item: "chicken-thigh", add: 1000, status: null },
    { item: "rice", add: 1000, status: null },
    { item: "salt", add: 0, status: "have" as const },
    { item: "olive-oil", add: 0, status: "have" as const },
    { item: "cumin", add: 0, status: "have" as const },
  ];
  assert.deepEqual(undoOf(changes, stock), {
    added: [
      { item: "chicken-thigh", qty: 1000 },
      { item: "rice", qty: 1000 },
    ],
    restore: [
      { item: "salt", status: "low" },
      { item: "olive-oil", status: null },
    ],
  });
});

test("a shop that changed nothing has nothing to undo", () => {
  assert.deepEqual(undoOf([], stock), { added: [], restore: [] });
});
