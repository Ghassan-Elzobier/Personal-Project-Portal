import { test } from "node:test";
import assert from "node:assert/strict";
import { setRows } from "./next-set.ts";

// The rows on an exercise card. A set added with "+ Add a set" and then ticked once
// showed a second, empty row under it, because the tap and the logged set were both
// counted.

test("a set added with + Add a set and then logged is one row, not two", () => {
  assert.equal(setRows(4, [], 0), 4, "the planned sets");
  assert.equal(setRows(4, [], 5), 5, "one tap adds a fifth row");
  assert.equal(setRows(4, [1, 2, 3, 4, 5], 5), 5, "logging the fifth set keeps five rows");
  assert.equal(setRows(4, [1, 2, 3, 4, 5], 6), 6, "another tap adds a sixth");
  assert.equal(setRows(4, [5], 0), 5, "after a reload the logged fifth set keeps its row");
  assert.equal(setRows(3, [1], 0), 3, "a session part done still shows every planned set");
});
