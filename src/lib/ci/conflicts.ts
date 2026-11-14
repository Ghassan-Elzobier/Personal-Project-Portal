// Pull requests that fall out of date when another one merges. When main moves,
// every open pull request is checked for a merge conflict, told which files
// conflict, and, on the owner's own claude/ branches, Claude merges main in and
// resolves it (.github/workflows/pr-conflicts.yml, scripts/pr-conflicts.mjs).
// Pure, so it is tested; the I/O is in the script.

export const MAX_RESOLVE_ATTEMPTS = 2;

/** The conflicted paths in `git merge-tree --write-tree --name-only` output (after the tree id, before the blank line). */
export function conflictedFiles(output: string): string[] {
  const [, ...rest] = output.split("\n");
  const files: string[] = [];
  for (const line of rest) {
    if (!line.trim()) break;
    files.push(line.trim());
  }
  return files;
}

/** In the comment the triage leaves, so a pull request hears about a conflict once per head commit. */
export const conflictMarker = (headSha: string) => `<!-- merge-conflict:${headSha} -->`;

/** Same rules as a CI fix: the owner's own branches, never a fork, a couple of tries, unless told not to. */
export function shouldResolveConflict(input: {
  branch: string;
  sameRepo: boolean;
  attempts: number;
  labels: string[];
  files: string[];
}): boolean {
  if (!input.sameRepo || !input.branch.startsWith("claude/")) return false;
  if (input.labels.includes("no-autofix") || input.files.length === 0) return false;
  return input.attempts < MAX_RESOLVE_ATTEMPTS;
}
