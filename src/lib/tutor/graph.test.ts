import { test } from "node:test";
import assert from "node:assert/strict";
import { searchClaims, unitScope } from "./graph.ts";

const rows = [
  { unit: { ref: "pmpp-4" }, task: { gid: "40" } },
  { unit: { ref: "pmpp-5", needs: ["pmpp-4", "axler-1", "pmpp-4"] }, task: { gid: "50" } },
  { unit: { ref: "axler-1" }, task: { gid: "10" } },
];

test("a unit's scope is its own task and the tasks of what it needs, once each", () => {
  assert.deepEqual(unitScope(rows, "50"), ["50", "40", "10"]);
});

test("a unit with no needs has only itself, and an unknown task still answers", () => {
  assert.deepEqual(unitScope(rows, "40"), ["40"]);
  assert.deepEqual(unitScope(rows, "999"), ["999"]);
});

const claims = [
  { gid: "1", name: "Tiling", statement: "Loading a tile once cuts global reads." },
  { gid: "2", name: "Warps", statement: "Threads in a warp run in lockstep." },
];

test("a search needs every word, in the name or the statement", () => {
  assert.deepEqual(
    searchClaims(claims, "TILE reads").map((c) => c.gid),
    ["1"],
  );
  assert.deepEqual(
    searchClaims(claims, "warp lockstep").map((c) => c.gid),
    ["2"],
  );
  assert.deepEqual(searchClaims(claims, "tile lockstep"), []);
});

test("no words returns everything", () => {
  assert.equal(searchClaims(claims, "  ").length, 2);
});
