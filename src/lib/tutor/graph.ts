// Which claims bear on a unit, and finding claims by words. Claims are the
// owner's own wording of what was taught; the book's text never goes in them.

type Row = { unit: { ref: string; needs?: string[] }; task: { gid: string } };

/**
 * The task gids whose claims matter for a unit: its own, and those of the
 * units it needs, since a lesson builds on what was held before it.
 */
export function unitScope(rows: Row[], taskGid: string): string[] {
  const row = rows.find((r) => r.task.gid === taskGid);
  if (!row) return [taskGid];
  const needed = (row.unit.needs ?? []).flatMap((ref) => rows.find((r) => r.unit.ref === ref)?.task.gid ?? []);
  return [...new Set([taskGid, ...needed])];
}

export type Claim = { gid: string; name: string; statement: string };

/** Claims containing every word, in name or statement, ignoring case. No words means all of them. */
export function searchClaims<T extends Claim>(claims: T[], words: string): T[] {
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return claims;
  return claims.filter((c) => {
    const text = `${c.name} ${c.statement}`.toLowerCase();
    return terms.every((t) => text.includes(t));
  });
}
