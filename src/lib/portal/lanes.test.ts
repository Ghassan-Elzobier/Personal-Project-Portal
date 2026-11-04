import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutLanes, snap } from "./lanes.ts";

test("separate blocks each get the full width", () => {
  const lanes = layoutLanes([
    { id: "a", start: 540, end: 600 },
    { id: "b", start: 600, end: 660 },
  ]);
  assert.deepEqual(lanes.get("a"), { id: "a", lane: 0, lanes: 1 });
  assert.deepEqual(lanes.get("b"), { id: "b", lane: 0, lanes: 1 });
});

test("overlapping blocks share a cluster and reuse free lanes", () => {
  const lanes = layoutLanes([
    { id: "a", start: 540, end: 660 },
    { id: "b", start: 570, end: 600 },
    { id: "c", start: 610, end: 640 },
  ]);
  assert.equal(lanes.get("a")!.lanes, 2);
  assert.equal(lanes.get("b")!.lane, 1);
  assert.equal(lanes.get("c")!.lane, 1);
});

test("snap rounds to the step and stays inside the day", () => {
  assert.equal(snap(547), 540);
  assert.equal(snap(553), 555);
  assert.equal(snap(-20), 0);
  assert.equal(snap(1439), 1425);
});
