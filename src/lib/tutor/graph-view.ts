// The knowledge graph as the Graph page shows it: claims grouped by the unit they
// were taught on, each with what it follows from and what it leads to. A chain's
// premises are used together, so they are shown together, never as separate causes.

type ClaimIn = { gid: string; name: string; statement: string; task_gid?: string | null; session_gid?: string | null };
type ChainIn = { premises: (number | string)[]; conclusion: string };

export type GraphClaim = {
  gid: string;
  name: string;
  statement: string;
  sessionGid: string | null;
  /** Each entry is one argument: the claims that together give this one. */
  because: string[][];
  leadsTo: string[];
};
export type GraphGroup = { unit: string | null; claims: GraphClaim[] };

export function buildGraph(input: { claims: ClaimIn[]; chains: ChainIn[]; units: Map<string, string> }): GraphGroup[] {
  const names = new Map(input.claims.map((c) => [c.gid, c.name]));
  const nameOf = (gid: number | string) => names.get(String(gid));

  const because = new Map<string, string[][]>();
  const leadsTo = new Map<string, Set<string>>();
  for (const chain of input.chains) {
    const premises = chain.premises.map(nameOf).filter((n): n is string => !!n);
    const conclusion = nameOf(chain.conclusion);
    if (!conclusion || premises.length === 0) continue;
    because.set(chain.conclusion, [...(because.get(chain.conclusion) ?? []), premises]);
    for (const p of chain.premises) {
      const key = String(p);
      leadsTo.set(key, (leadsTo.get(key) ?? new Set()).add(conclusion));
    }
  }

  const groups = new Map<string | null, GraphClaim[]>();
  for (const c of [...input.claims].sort((a, b) => Number(a.gid) - Number(b.gid))) {
    const unit = c.task_gid ? (input.units.get(c.task_gid) ?? null) : null;
    const claim: GraphClaim = {
      gid: c.gid,
      name: c.name,
      statement: c.statement,
      sessionGid: c.session_gid ?? null,
      because: because.get(c.gid) ?? [],
      leadsTo: [...(leadsTo.get(c.gid) ?? [])],
    };
    groups.set(unit, [...(groups.get(unit) ?? []), claim]);
  }

  return [...groups]
    .map(([unit, claims]) => ({ unit, claims }))
    .sort((a, b) => (a.unit === null ? 1 : b.unit === null ? -1 : a.unit.localeCompare(b.unit)));
}

/** Claims containing every word, in name or statement; groups left empty drop out. */
export function filterGraph(groups: GraphGroup[], words: string): GraphGroup[] {
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;
  return groups
    .map((g) => ({
      ...g,
      claims: g.claims.filter((c) => {
        const text = `${c.name} ${c.statement}`.toLowerCase();
        return terms.every((t) => text.includes(t));
      }),
    }))
    .filter((g) => g.claims.length > 0);
}
