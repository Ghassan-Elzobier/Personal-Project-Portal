// R&D builds what it proposes, straight away. The filing job (scripts/rnd.mjs
// file, no AI) marks each new proposal it hands on, the strongest first and at
// most RND_BUILD_PER_RUN a run; when the R&D run ends, its own workflow
// (.github/workflows/rnd-build.yml) picks the marked issues of that run and
// Claude builds each one with /ship, opening a pull request that closes it.
// R&D itself still writes nothing but issues. Pure, so it is tested; the I/O is
// in scripts/rnd.mjs.

import type { Publishable } from "./sweep.ts";

/** Hidden in a proposal the build picks up, beside its focus marker (and unlike it, so `focusOf` never reads it). */
export const BUILD_MARKER = "<!-- rnd-build -->";

/** RND_BUILD_PER_RUN when it is not set: a scheduled run files one proposal at most, so it is always built. */
export const DEFAULT_BUILDS_PER_RUN = 3;
const MOST = 15;

/** How many of a run's new proposals are built: the repository variable, 0 to 15; 0 files them unbuilt. */
export function buildsPerRun(value: string | undefined): number {
  const n = Number((value ?? "").trim());
  if (value === undefined || value.trim() === "" || !Number.isInteger(n)) return DEFAULT_BUILDS_PER_RUN;
  return Math.min(Math.max(n, 0), MOST);
}

/**
 * Which answers, in filing order (weakest first), are built: the last `cap`
 * new proposals, so a sweep builds its strongest. Updates to an open proposal
 * and empty answers never are.
 */
export function toBuild<T extends { result: Publishable }>(answers: T[], cap: number): Set<T> {
  const proposals = answers.filter((a) => a.result.outcome === "proposal");
  return new Set(cap > 0 ? proposals.slice(-cap) : []);
}

/** The number in an issue's address, as `gh issue create` prints it. */
export function issueNumber(url: string): number | null {
  const m = /\/issues\/(\d+)\s*$/.exec(url.trim());
  return m ? Number(m[1]) : null;
}

export type OpenProposal = { number: number; body: string };

/**
 * What a finished R&D run hands to the build: its marked proposals that are
 * still open and have no pull request yet, newest (strongest) first. `runUrl`
 * is the run's address, which the filer wrote into each issue it filed.
 */
export function pickBuilds(open: OpenProposal[], runUrl: string, built: Set<number>): number[] {
  return open
    .filter((i) => i.body.includes(BUILD_MARKER) && i.body.includes(`(${runUrl})`) && !built.has(i.number))
    .map((i) => i.number)
    .sort((a, b) => b - a);
}

/** The issues open pull requests already build: their bodies close them, or their branches are named for them. */
export function alreadyBuilt(prs: { body: string | null; branch: string }[]): Set<number> {
  const out = new Set<number>();
  for (const pr of prs) {
    const named = /^claude\/(?:issue|rnd)-(\d+)(?:-|$)/.exec(pr.branch);
    if (named) out.add(Number(named[1]));
    for (const m of (pr.body ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?) #(\d+)\b/gi))
      out.add(Number(m[1]));
  }
  return out;
}
