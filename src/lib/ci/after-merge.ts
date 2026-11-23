// After a pull request merges, the issue it was built for closes, and agent
// branches that main already holds go. GitHub closes an issue that a pull
// request's body names ("Closes #N") and deletes the merged branch by itself;
// this catches what it misses. A branch built on GitHub names its issue
// (claude/issue-N-… from @claude, claude/rnd-N-… from R&D's build,
// claude/fix-N-… from the error triage), so a pull request opened from a
// "Create PR" link that only says "addresses #N" still closes it. Branches left
// from before GitHub deleted merged ones, or pushed to after a merge, are swept
// when main holds every change on them. Pure, so it is tested; the I/O is in
// scripts/after-merge.mjs (.github/workflows/after-merge.yml).

/** The issue a branch was built for, from its name, or null. */
export function builtFor(branch: string): number | null {
  const m = /^claude\/(?:issue|rnd|fix)-(\d+)(?:-|$)/.exec(branch);
  return m ? Number(m[1]) : null;
}

/** Open issues whose built branch has merged, each with the first pull request that merged it. */
export function builtIssues(
  open: number[],
  merged: { number: number; branch: string }[],
): { issue: number; pr: number }[] {
  const waiting = new Set(open);
  const out = new Map<number, number>();
  for (const pr of [...merged].sort((a, b) => a.number - b.number)) {
    const issue = builtFor(pr.branch);
    if (issue !== null && waiting.has(issue) && !out.has(issue)) out.set(issue, pr.number);
  }
  return [...out].map(([issue, pr]) => ({ issue, pr }));
}

export type BranchState = {
  name: string;
  /** Commits on the branch that main does not have. */
  ahead: number;
  /** Of those, the ones whose change main has under another commit (`git cherry` marks them "-"). */
  equivalent: number;
  /** An open pull request has it as its head. */
  open: boolean;
};

/**
 * Which agent branches can go: those main holds every change of, by commit or
 * by an equal patch (a branch rebased and merged under new commits), with no
 * open pull request on them. Deleting one loses nothing. Any other branch,
 * and any branch outside claude/, is the owner's to decide on.
 */
export function spentBranches(branches: BranchState[]): { remove: string[]; keep: { name: string; why: string }[] } {
  const remove: string[] = [];
  const keep: { name: string; why: string }[] = [];
  for (const b of [...branches].sort((x, y) => x.name.localeCompare(y.name))) {
    if (!b.name.startsWith("claude/")) continue;
    if (b.open) keep.push({ name: b.name, why: "an open pull request uses it" });
    else if (b.equivalent >= b.ahead) remove.push(b.name);
    else {
      const left = b.ahead - b.equivalent;
      keep.push({ name: b.name, why: `${left} ${left === 1 ? "commit" : "commits"} main does not have` });
    }
  }
  return { remove, keep };
}

/** `git cherry` output: how many commits it lists, and how many of those main has as an equal patch. */
export function cherryCounts(output: string): { ahead: number; equivalent: number } {
  const lines = output.split("\n").filter((l) => /^[+-] /.test(l));
  return { ahead: lines.length, equivalent: lines.filter((l) => l.startsWith("- ")).length };
}

/** The comment left on an issue closed this way, so the thread says what closed it. */
export const closingComment = (pr: number) =>
  `Built in #${pr}, which has merged, so this is done. (Closed by the after-merge check: the branch named this issue.)`;
