// The parts of the pull request review that need no AI
// (.github/workflows/claude-review.yml, scripts/review.mjs). The review itself is a
// Claude session following .claude/commands/review-pr.md; this decides what it is
// asked to read, and afterwards whether it really posted a review of the commit the
// pull request is at. A review that posts nothing used to look like a pass.
// Pure, so it is tested.

/** A comment on the pull request, as GitHub lists it. */
export type PrComment = { author: string; body: string; createdAt: string };

/** Who the review posts as: the Claude app, or the job's own token. Anyone can comment on a public pull request. */
export const REVIEWERS = ["claude[bot]", "github-actions[bot]"];

/** The shape the review answers in, for --json-schema. */
export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    reviewed_sha: { type: "string", pattern: "^[0-9a-f]{40}$", description: "The full commit you reviewed." },
    findings: { type: "integer", minimum: 0, description: "How many findings you posted." },
  },
  required: ["reviewed_sha", "findings"],
  additionalProperties: false,
};

const short = (sha: string) => sha.slice(0, 7);

/** The commits a comment says it reviewed: "Reviewed abc1234: …", with seven or more characters of the commit. */
export function reviewedIn(body: string): string[] {
  return [...body.matchAll(/\bReviewed `?([0-9a-f]{7,40})\b/g)].map((m) => m[1]);
}

const fromReview = (comments: PrComment[]) =>
  comments
    .filter((c) => REVIEWERS.includes(c.author))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((c) => reviewedIn(c.body));

const names = (reviewed: string, commit: string) => commit.startsWith(reviewed);

export type Scope =
  /** The first review: the whole pull request. */
  | { kind: "whole" }
  /** A push after a review: what changed since the commit that review covered. */
  | { kind: "since"; sha: string }
  /** This commit already has its review (the job was run again). */
  | { kind: "done" };

/** What this run should review, from the reviews already on the pull request. */
export function scopeFor(comments: PrComment[], head: string): Scope {
  const reviewed = fromReview(comments);
  if (reviewed.some((sha) => names(sha, head))) return { kind: "done" };
  return reviewed.length ? { kind: "since", sha: reviewed[0] } : { kind: "whole" };
}

/**
 * The prompt for a run: the repository's own instructions for a review, with the
 * pull request filled in. Nothing the pull request's author wrote goes in here;
 * that reaches the review as files to read.
 */
export function reviewPrompt(instructions: string, pr: { number: number; head: string }): string {
  const body = instructions.replace(/^---\n[\s\S]*?\n---\n/, "").replaceAll("$ARGUMENTS", String(pr.number));
  return [
    body.trim(),
    "",
    "## This run",
    "",
    `This is the automatic review of pull request #${pr.number}, at commit ${pr.head}.`,
    "Read .review/brief.md first. Post the review as section 5 says, then answer in the required JSON shape.",
  ].join("\n");
}

export type Verdict = { ok: true; summary: string } | { ok: false; problem: string };

const RETRY = "Run the job again, or ask Claude for a review in a comment.";

/**
 * Whether the pull request has a review of the commit it is at. `answer` is the
 * review's JSON answer, or nothing when the review step did not run or gave none.
 */
export function checkReview(input: { head: string; comments: PrComment[]; answer: string | undefined }): Verdict {
  const { head } = input;
  const posted = fromReview(input.comments).some((sha) => names(sha, head));
  const raw = input.answer?.trim() ?? "";
  if (!raw) {
    return posted
      ? { ok: true, summary: `Reviewed ${short(head)} already: the review is on the pull request.` }
      : { ok: false, problem: `The review finished without posting anything for ${short(head)}. ${RETRY}` };
  }
  let answer: { reviewed_sha?: unknown; findings?: unknown };
  try {
    answer = JSON.parse(raw) as typeof answer;
  } catch {
    return { ok: false, problem: `The review's answer was not JSON, so nothing says what it covered. ${RETRY}` };
  }
  const reviewed = typeof answer.reviewed_sha === "string" ? answer.reviewed_sha : "";
  if (reviewed !== head)
    return {
      ok: false,
      problem: `The review says it covered ${reviewed ? short(reviewed) : "no commit"}, but the pull request is at ${short(head)}. ${RETRY}`,
    };
  if (!posted)
    return {
      ok: false,
      problem: `The review ran, but no comment from it on the pull request names ${short(head)}, so there is nothing to read. ${RETRY}`,
    };
  const findings = typeof answer.findings === "number" ? answer.findings : 0;
  return {
    ok: true,
    summary:
      findings === 0
        ? `Reviewed ${short(head)}: no issues found.`
        : `Reviewed ${short(head)}: ${findings} ${findings === 1 ? "finding" : "findings"}, as comments on the pull request.`,
  };
}
