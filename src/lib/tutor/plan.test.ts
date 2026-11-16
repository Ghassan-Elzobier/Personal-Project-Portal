import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan } from "./plan.ts";

const node = (id: string, status = "todo") => ({ id, label: `Step ${id}`, status });

test("a small plan is accepted, with todo as the default status", () => {
  const result = parsePlan({ nodes: [{ id: "a", label: "Memory" }, node("b")], edges: [["a", "b"]] });
  assert.ok("plan" in result);
  assert.equal(result.plan.nodes[0].status, "todo");
  assert.deepEqual(result.plan.edges, [["a", "b"]]);
});

test("a repeated edge counts once", () => {
  const result = parsePlan({
    nodes: [node("a"), node("b")],
    edges: [
      ["a", "b"],
      ["a", "b"],
    ],
  });
  assert.ok("plan" in result);
  assert.equal(result.plan.edges.length, 1);
});

test("a plan that loops is refused", () => {
  const result = parsePlan({
    nodes: [node("a"), node("b"), node("c")],
    edges: [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ],
  });
  assert.deepEqual(result, { error: "The plan loops: some nodes depend on each other." });
});

test("an edge to a node that is not there is refused, naming it", () => {
  const result = parsePlan({ nodes: [node("a")], edges: [["a", "zz"]] });
  assert.ok("error" in result);
  assert.match(result.error, /'zz'/);
});

test("duplicate ids, bad ids and unknown statuses are refused", () => {
  assert.ok("error" in parsePlan({ nodes: [node("a"), node("a")] }));
  assert.ok("error" in parsePlan({ nodes: [node("Not OK")] }));
  assert.ok("error" in parsePlan({ nodes: [node("a", "finished")] }));
});

test("an empty plan, too many nodes and a self-edge are refused", () => {
  assert.ok("error" in parsePlan({ nodes: [] }));
  assert.ok("error" in parsePlan({ nodes: Array.from({ length: 41 }, (_, i) => node(`n${i}`)) }));
  assert.ok("error" in parsePlan({ nodes: [node("a")], edges: [["a", "a"]] }));
});
