/**
 * Opening an R&D build's pull request under the owner's account (scripts/rnd-open.mjs).
 *
 * Claude pushes its branch and writes what the pull request should say into
 * .rnd-pr/. A job of its own, on a fresh runner Claude never touched, opens it with
 * the owner's token. What Claude wrote is data from a session that read web-sourced
 * text, so it is checked here before it goes anywhere.
 */

/** The longest title kept: GitHub shows about this much in a list. */
export const TITLE_MAX = 120;
/** The longest description kept, well under GitHub's 65,536 characters. */
export const BODY_MAX = 60_000;

/** The branch Claude pushed for this proposal, if its name is one R&D build gives: claude/rnd-<issue>-<short-name>. */
export function branchFor(issue: number, raw: string): string | null {
  const name = raw.trim();
  return new RegExp(`^claude/rnd-${issue}-[a-z0-9][a-z0-9-]{0,60}$`).test(name) ? name : null;
}

/** The title: its first line, on one line, cut to TITLE_MAX. Null when there is none. */
export function titleOf(raw: string): string | null {
  const line = (raw.split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

const ATTRIBUTION = /^\s*(co-authored-by:.*|.*generated (with|by) \[?claude code.*)$/i;

/**
 * The description: cut to BODY_MAX, without AI attribution lines (AGENTS.md), and
 * ending with "Closes #<issue>" so merging it closes the proposal.
 */
export function bodyOf(raw: string, issue: number): string {
  const closes = `Closes #${issue}`;
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !ATTRIBUTION.test(l));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && lines[lines.length - 1].trim() === closes) lines.pop();
  let text = lines.join("\n").trimEnd();
  const room = BODY_MAX - closes.length - 3; // the blank line between, and the last newline
  if (text.length > room) text = `${text.slice(0, room - 1).trimEnd()}…`;
  return text ? `${text}\n\n${closes}\n` : `${closes}\n`;
}
