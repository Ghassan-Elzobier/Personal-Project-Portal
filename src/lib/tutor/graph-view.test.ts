import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, filterGraph } from "./graph-view.ts";

const claims = [
  { gid: "1", name: "Reuse", statement: "Tiles are reused by every thread.", task_gid: "50", session_gid: "7" },
  { gid: "2", name: "Bandwidth", statement: "Memory bandwidth limits the kernel.", task_gid: "50", session_gid: "7" },
  { gid: "3", name: "Tiling", statement: "Loading a tile once cuts global reads.", task_gid: "50", session_gid: "7" },
  { gid: "4", name: "Warps", statement: "Threads in a warp run in lockstep.", task_gid: null, session_gid: null },
];
const units = new Map([["50", "PMPP 5"]]);

test("a claim shows what it follows from, together, and what it leads to", () => {
  const groups = buildGraph({ claims, chains: [{ premises: [1, 2], conclusion: "3" }], units });
  const [pmpp] = groups;
  const tiling = pmpp.claims.find((c) => c.name === "Tiling");
  assert.deepEqual(tiling?.because, [["Reuse", "Bandwidth"]]);
  assert.deepEqual(pmpp.claims.find((c) => c.name === "Reuse")?.leadsTo, ["Tiling"]);
  assert.deepEqual(pmpp.claims.find((c) => c.name === "Bandwidth")?.leadsTo, ["Tiling"]);
});

test("two arguments for one claim stay two separate arguments", () => {
  const groups = buildGraph({
    claims,
    chains: [
      { premises: [1], conclusion: "3" },
      { premises: [2], conclusion: "3" },
    ],
    units,
  });
  assert.deepEqual(groups[0].claims.find((c) => c.gid === "3")?.because, [["Reuse"], ["Bandwidth"]]);
});

test("groups are sorted by unit with claims that have none last", () => {
  const groups = buildGraph({ claims, chains: [], units });
  assert.deepEqual(
    groups.map((g) => g.unit),
    ["PMPP 5", null],
  );
});

test("a chain naming a claim that is not there is ignored", () => {
  const groups = buildGraph({ claims, chains: [{ premises: [99], conclusion: "3" }], units });
  assert.deepEqual(groups[0].claims.find((c) => c.gid === "3")?.because, []);
});

test("filtering needs every word and drops empty groups", () => {
  const groups = buildGraph({ claims, chains: [], units });
  assert.deepEqual(
    filterGraph(groups, "warp lockstep").map((g) => g.unit),
    [null],
  );
  assert.equal(filterGraph(groups, "nothing like this").length, 0);
  assert.equal(filterGraph(groups, " ").length, 2);
});
