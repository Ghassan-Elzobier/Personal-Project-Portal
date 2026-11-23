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

/**
 * How often a run's pick asks for its proposals before it decides there are none,
 * and how long it waits between: a just-filed issue can be missing from the list
 * for a few seconds. Well inside the pick job's 5 minutes.
 */
export const PICK_TRIES = 5;
export const PICK_PAUSE_MS = 15_000;

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

/**
 * Whether a build left a mark: a pull request open for the issue, or a comment on it
 * by a bot (Claude saying why it built nothing) since the build began. A build that
 * left neither did nothing the owner can see, and fails rather than going green.
 */
export function leftAMark(
  issue: number,
  prs: { body: string | null; branch: string }[],
  comments: { author: string; at: string }[],
  since: string,
): boolean {
  return alreadyBuilt(prs).has(issue) || comments.some((c) => c.author.endsWith("[bot]") && c.at >= since);
}

const cut = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/**
 * What Claude did in a build, a line a step, from the action's transcript (the Agent
 * SDK's messages): what it said, each tool it called and the start of each result,
 * and how it ended. Printed in the run's log when a build leaves no mark, since the
 * action hides the conversation and the log is the one place it can be read.
 */
export function digest(transcript: unknown): string[] {
  const lines: string[] = [];
  type Block = { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
  const blocks = (m: { message?: { content?: unknown } }): Block[] =>
    Array.isArray(m.message?.content) ? (m.message.content as Block[]) : [];
  for (const m of Array.isArray(transcript) ? transcript : []) {
    if (!m || typeof m !== "object") continue;
    const msg = m as {
      type?: string;
      subtype?: string;
      result?: unknown;
      num_turns?: number;
      message?: { content?: unknown };
    };
    if (msg.type === "assistant")
      for (const b of blocks(msg)) {
        if (b.type === "text" && b.text) lines.push(`Claude: ${cut(b.text, 800)}`);
        if (b.type === "tool_use") lines.push(`  ${b.name ?? "tool"}: ${cut(JSON.stringify(b.input ?? {}), 300)}`);
      }
    if (msg.type === "user")
      for (const b of blocks(msg)) {
        if (b.type !== "tool_result") continue;
        const text = Array.isArray(b.content)
          ? (b.content as Block[]).map((c) => c.text ?? "").join(" ")
          : String(b.content ?? "");
        lines.push(`    → ${cut(text, 400)}`);
      }
    if (msg.type === "result")
      lines.push(
        `Ended: ${msg.subtype ?? "?"} after ${msg.num_turns ?? "?"} turns` +
          (typeof msg.result === "string" && msg.result ? `: ${cut(msg.result, 800)}` : ""),
      );
  }
  return lines;
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
