// One run of R&D, over one focus or over all of them. The schedule takes one
// focus a run (foci.ts). By hand the owner can ask for a sweep: every focus at
// once, each in its own job of the workflow's matrix (.github/workflows/rnd.yml),
// and one filing job for all the answers. Pure; the I/O is in scripts/rnd.mjs.

import { FOCI, planRun, type Focus, type PlanInput } from "./foci.ts";
import { checkResult, sensitiveIn, type Result } from "./result.ts";

export type Sweep = { run: true; foci: Focus[]; why: string } | { run: false; why: string };

/**
 * What a run researches: one focus, as planRun decides, or every focus when the
 * owner asks for all of them by hand. The schedule never sweeps: a sweep costs
 * as many Claude sessions as there are foci.
 */
export function planSweep(input: PlanInput & { all: boolean }): Sweep {
  if (input.all && input.event === "workflow_dispatch")
    return { run: true, foci: FOCI, why: "run by hand on every focus" };
  const plan = planRun(input);
  return plan.run ? { run: true, foci: [plan.focus], why: plan.why } : plan;
}

/** A result that may be published. A private finding never is. */
export type Publishable = Exclude<Result, { outcome: "private" }>;

/** One focus's answer after its checks: what to file, or why nothing can be. */
export type Answer = { focus: Focus; result: Publishable; trimmed: string[] } | { focus: Focus; problem: string };

/**
 * Reads what a research job handed on. A problem names the focus, fields and
 * kinds only, never the answer's own text: it is printed in the public run log.
 */
export function readAnswer(focus: Focus, raw: string | undefined): Answer {
  const problem = (text: string): Answer => ({ focus, problem: `The ${focus.id} focus ${text}` });
  if (!raw?.trim())
    return problem(
      "finished without an answer in its JSON shape. Look at its research job's log; " +
        "the agent must list StructuredOutput among its tools.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return problem("gave an answer that was not JSON.");
  }
  const checked = checkResult(parsed);
  if (!checked.ok) return problem(`gave an answer that failed its checks: ${checked.problems.join("; ")}.`);
  const result = checked.result;
  if (result.outcome === "private")
    return problem(
      `found a security weakness in the "${result.area}" area that should not be public. ` +
        `Look at it in a private session: ask the rnd agent to check the "${result.area}" area for weaknesses.`,
    );
  const sensitive = sensitiveIn(result);
  if (sensitive.length)
    return problem(
      `gave an answer that looked as if it held ${sensitive.join(", ")}. ` +
        "If another run on it does so again, look at what the agent read.",
    );
  return { focus, result, trimmed: checked.trimmed };
}

const SIZES = { small: 0, medium: 1, large: 2 };
const strength = (r: Publishable) => (r.outcome === "nothing" ? 0 : r.proposal.impact * r.proposal.confidence);
const size = (r: Publishable) => (r.outcome === "nothing" ? 0 : SIZES[r.proposal.size]);

/**
 * The order to file answers in: weakest first. GitHub lists the newest issue
 * first, so the proposal with the most impact for the most confidence (the
 * smaller one on a tie) is filed last and is the first the owner reads.
 */
export function filingOrder<T extends { result: Publishable }>(answers: T[]): T[] {
  return [...answers].sort((a, b) => strength(a.result) - strength(b.result) || size(b.result) - size(a.result));
}
