// Side-by-side layout for overlapping blocks in one day column. Pure.

export type Span = { id: string; start: number; end: number };
export type Placed = { id: string; lane: number; lanes: number };

/**
 * Gives each block a lane. Blocks that overlap, directly or through a chain,
 * form a cluster and share its lane count, so widths line up.
 */
export function layoutLanes(spans: Span[]): Map<string, Placed> {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, Placed>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const c of cluster) result.set(c.id, { id: c.id, lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const s of sorted) {
    if (s.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[lane] = s.end;
    }
    cluster.push({ id: s.id, lane });
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
  return result;
}

/** Snaps minutes to a step, within the day. */
export function snap(minutes: number, step = 15): number {
  return Math.min(24 * 60 - step, Math.max(0, Math.round(minutes / step) * step));
}
