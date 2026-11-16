// A lesson's plan: the smallest map from what the owner holds to the goal. Nodes
// are landmarks, not lesson segments; an edge [a, b] means a comes before b.
// Claude draws it and the portal checks it, so a bad plan is refused with a reason.

export const PLAN_STATUSES = ["todo", "next", "done"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type Plan = {
  nodes: { id: string; label: string; status: PlanStatus }[];
  edges: [string, string][];
};

const ID = /^[a-z0-9-]{1,30}$/;
const MAX_NODES = 40;
const MAX_EDGES = 120;

export function parsePlan(input: unknown): { plan: Plan } | { error: string } {
  if (!input || typeof input !== "object") return { error: "A plan needs nodes and edges." };
  const raw = input as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > MAX_NODES)
    return { error: `A plan has 1 to ${MAX_NODES} nodes.` };
  const edgesIn = raw.edges ?? [];
  if (!Array.isArray(edgesIn) || edgesIn.length > MAX_EDGES) return { error: `A plan has at most ${MAX_EDGES} edges.` };

  const nodes: Plan["nodes"] = [];
  for (const n of raw.nodes) {
    const node = (n ?? {}) as { id?: unknown; label?: unknown; status?: unknown };
    const id = typeof node.id === "string" ? node.id : "";
    const label = typeof node.label === "string" ? node.label.trim() : "";
    if (!ID.test(id)) return { error: `A node id must be lowercase letters, digits and dashes, not '${id}'.` };
    if (nodes.some((x) => x.id === id)) return { error: `Two nodes share the id '${id}'.` };
    if (label.length < 1 || label.length > 80) return { error: `Node '${id}' needs a label of 1 to 80 characters.` };
    const status = node.status ?? "todo";
    if (!PLAN_STATUSES.includes(status as PlanStatus))
      return { error: `Node '${id}' has status '${String(status)}'; use todo, next or done.` };
    nodes.push({ id, label, status: status as PlanStatus });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: Plan["edges"] = [];
  for (const e of edgesIn) {
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== "string" || typeof e[1] !== "string")
      return { error: "Each edge is a pair of node ids: [before, after]." };
    const [from, to] = e as [string, string];
    if (!ids.has(from) || !ids.has(to))
      return { error: `The edge '${from}' to '${to}' names a node that is not in the plan.` };
    if (from === to) return { error: `Node '${from}' cannot come before itself.` };
    if (!edges.some(([a, b]) => a === from && b === to)) edges.push([from, to]);
  }

  // A plan that loops can never be walked: peel off nodes with nothing before them.
  const before = new Map(nodes.map((n) => [n.id, 0]));
  for (const [, to] of edges) before.set(to, (before.get(to) ?? 0) + 1);
  const ready = nodes.filter((n) => before.get(n.id) === 0).map((n) => n.id);
  let walked = 0;
  while (ready.length) {
    const id = ready.pop() as string;
    walked++;
    for (const [from, to] of edges)
      if (from === id) {
        before.set(to, (before.get(to) ?? 1) - 1);
        if (before.get(to) === 0) ready.push(to);
      }
  }
  if (walked !== nodes.length) return { error: "The plan loops: some nodes depend on each other." };

  return { plan: { nodes, edges } };
}
