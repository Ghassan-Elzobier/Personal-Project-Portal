// The parts of the pull request review that need no AI
// (.github/workflows/claude-review.yml, scripts/review.mjs).
//
// The review itself is a Claude session that can only read: it follows
// .claude/commands/review-pr.md and answers in a fixed JSON shape. Everything
// around it is here: what it is asked to read, whether its answer is really about
// the commit the pull request is at, and the comments a script then posts for it.
// So the review is posted by code that can't be talked into anything, the reviewer
// holds no token that can write, and a review that gives no answer fails the check
// instead of looking like a pass. Pure, so it is tested.

/** A comment on the pull request, as GitHub lists it. */
export type PrComment = { id?: number; author: string; body: string; createdAt: string };

/** Who posts reviews: the job's own account, and the Claude app, which posted them before. Anyone can comment on a public pull request. */
export const REVIEWERS = ["github-actions[bot]", "claude[bot]"];

export const MAX_FINDINGS = 20;

/** The shape the review answers in, for --json-schema. */
export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    reviewed_sha: {
      type: "string",
      pattern: "^[0-9a-f]{40}$",
      description: "The full commit you reviewed, as the brief gives it.",
    },
    summary: {
      type: "string",
      maxLength: 600,
      description: "One or two plain sentences: what you checked, and what you found.",
    },
    findings: {
      type: "array",
      maxItems: MAX_FINDINGS,
      description: "Only findings you checked. Empty when there are none.",
      items: {
        type: "object",
        properties: {
          file: { type: "string", maxLength: 300, description: "The file, as a path from the repository root." },
          line: {
            type: "integer",
            minimum: 1,
            description: "The line in that file as it is with this pull request applied.",
          },
          body: {
            type: "string",
            maxLength: 2000,
            description: "What is wrong and why. Quote the rule if it breaks one.",
          },
        },
        required: ["file", "line", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["reviewed_sha", "summary", "findings"],
  additionalProperties: false,
};

export type Finding = { file: string; line: number; body: string };
export type Review = { summary: string; findings: Finding[] };

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
  if (reviewed.some((sha) => head.startsWith(sha))) return { kind: "done" };
  return reviewed.length ? { kind: "since", sha: reviewed[0] } : { kind: "whole" };
}

/**
 * Whether the commits since the last review can be reviewed by themselves. Only
 * when they are the pull request's own work in a straight line: once the base
 * branch has been merged in, the difference between the two commits also holds
 * every other pull request merged meanwhile, and a branch pushed again from
 * scratch has no straight line at all. Then the whole pull request is reviewed.
 */
export function incremental(compare: { status: string; commits: { parents: number }[] }): boolean {
  return compare.status === "ahead" && compare.commits.length > 0 && compare.commits.every((c) => c.parents === 1);
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
    "Read .review/brief.md first, then answer in the required JSON shape. You post nothing yourself: a script posts your review from that answer.",
  ].join("\n");
}

const RETRY = "Run the job again, or ask Claude for a review in a comment.";

/**
 * The review's answer, checked. It has to be about the commit the pull request is
 * at, and every finding has to name a file, a line and what is wrong, or nothing
 * of it is posted.
 */
export function readReview(
  raw: string | undefined,
  head: string,
): { ok: true; review: Review } | { ok: false; problem: string } {
  const text = raw?.trim() ?? "";
  if (!text) return { ok: false, problem: `The review gave no answer for ${short(head)}. ${RETRY}` };
  let answer: { reviewed_sha?: unknown; summary?: unknown; findings?: unknown };
  try {
    answer = JSON.parse(text) as typeof answer;
  } catch {
    return { ok: false, problem: `The review's answer was not JSON, so nothing says what it found. ${RETRY}` };
  }
  if (typeof answer !== "object" || answer === null)
    return { ok: false, problem: `The review's answer was not JSON, so nothing says what it found. ${RETRY}` };
  const reviewed = typeof answer.reviewed_sha === "string" ? answer.reviewed_sha : "";
  if (reviewed !== head)
    return {
      ok: false,
      problem: `The review says it covered ${reviewed ? short(reviewed) : "no commit"}, but the pull request is at ${short(head)}. ${RETRY}`,
    };
  if (!Array.isArray(answer.findings))
    return { ok: false, problem: `The review's answer lists no findings, not even an empty list. ${RETRY}` };
  const findings: Finding[] = [];
  for (const f of answer.findings as { file?: unknown; line?: unknown; body?: unknown }[]) {
    const file = typeof f?.file === "string" ? f.file.trim() : "";
    const body = typeof f?.body === "string" ? f.body.trim() : "";
    if (!file || !body || typeof f.line !== "number" || !Number.isInteger(f.line) || f.line < 1)
      return {
        ok: false,
        problem: `One of the review's findings has no file, line or text, so none of it was posted. ${RETRY}`,
      };
    findings.push({ file: file.slice(0, 300), line: f.line, body: body.slice(0, 2000) });
  }
  const summary = typeof answer.summary === "string" ? answer.summary.trim().slice(0, 600) : "";
  return { ok: true, review: { summary, findings: findings.slice(0, MAX_FINDINGS) } };
}

/**
 * The lines of each file that a comment can be pinned to: the lines a pull
 * request's diff shows on its new side (added, or context). From a unified diff.
 */
export function commentable(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let lines: Set<number> | null = null;
  let next = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      lines = path === "/dev/null" ? null : new Set<number>();
      if (lines) files.set(path.replace(/^b\//, ""), lines);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!lines || line.startsWith("diff --git") || line.startsWith("--- ") || line.startsWith("\\")) continue;
    if (line.startsWith("-")) continue;
    if (line.startsWith("+") || line.startsWith(" ")) lines.add(next++);
  }
  return files;
}

/** Each finding goes on its line where the diff shows that line; the rest are only listed in the summary. */
export function place(findings: Finding[], lines: Map<string, Set<number>>): { inline: Finding[]; listed: Finding[] } {
  const inline = findings.filter((f) => lines.get(f.file)?.has(f.line));
  return { inline, listed: findings.filter((f) => !inline.includes(f)) };
}

/**
 * Text from the review, made safe to post from the job's own account: a name after
 * an @ would notify that person, or wake another workflow, so each @ is followed by
 * a zero-width space; and a comment marker is taken out, so it can't pose as one of
 * the job's own notes.
 */
export function quiet(text: string): string {
  return text.replace(/@(?=[\w-])/g, "@​").replace(/<!--[\s\S]*?(-->|$)/g, "");
}

/**
 * The review as one comment that stands by itself. Its first line names the commit,
 * which is how the next run knows what has been reviewed, and every finding is
 * listed, whether or not it could also be pinned to its line.
 */
export function reviewBody(review: Review, head: string): string {
  const n = review.findings.length;
  const verdict = n === 0 ? "no issues found." : `${n} ${n === 1 ? "finding" : "findings"}.`;
  const lines = [
    `## Code review`,
    "",
    `Reviewed ${head}: ${verdict}${review.summary ? ` ${quiet(review.summary)}` : ""}`,
  ];
  if (n > 0) {
    lines.push("");
    review.findings.forEach((f, i) => lines.push(`${i + 1}. \`${f.file}:${f.line}\`: ${quiet(f.body)}`, ""));
  }
  return lines.join("\n").trim();
}

/** Marks the note the job leaves on a pull request whose review is missing, so there is only ever one. */
export const NOTE_MARKER = "<!-- claude-review-missing -->";

/**
 * The note for the pull request itself when a review is missing: a red check should
 * say why where the owner is looking, not only in a log. It is worded so that it
 * can never pass for a review.
 */
export function missingNote(problem: string): string {
  return `${NOTE_MARKER}\n**The Claude review check failed: this commit has no review.**\n\n${problem}`;
}
