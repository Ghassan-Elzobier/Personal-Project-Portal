// The job board's reads, started together. The roles, sources and evidence don't
// need the study overview, so they start before it settles rather than after.
// Kept apart from load.ts (server-only) so the order can be tested.

export type BoardReads<R, S, E> = {
  postings: () => Promise<R>;
  sources: () => Promise<S>;
  evidence: () => Promise<E>;
};

export async function readBoard<O, R, S, E>(
  overview: O | Promise<O>,
  reads: BoardReads<R, S, E>,
): Promise<{ overview: O; rows: R; sources: S; evidence: E }> {
  // One Promise.all holds every read, so a failure in any is never left unhandled.
  const [study, [rows, sources, evidence]] = await Promise.all([
    overview,
    Promise.all([reads.postings(), reads.sources(), reads.evidence()]),
  ]);
  return { overview: study, rows, sources, evidence };
}
