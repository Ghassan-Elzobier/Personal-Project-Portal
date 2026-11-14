// Spotting a test that was switched off or focused, so getting green by
// silencing a check needs the owner's say-so (scripts/guard.mjs). The guard
// already stops edits to existing tests; this closes the gap for a test that is
// new on the branch, which is where an auto-healing agent would add `fixme`.

const SWITCHED_OFF = [
  /\b(?:test|it|describe)\.(?:fixme|only)\s*\(/,
  // Skipped by title, or with no condition at all. `test.skip(condition)` is how a spec limits itself.
  /\b(?:test|it|describe)\.skip\s*\(\s*(?:["'`]|\)|$)/,
  /\bx(?:test|it|describe)\s*\(/,
];

/** The added lines in a `git diff -U0` of the end-to-end specs that switch a test off or focus it, as `path: line`. */
export function addedSkips(diff: string): string[] {
  const found: string[] = [];
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "");
      file = /^e2e\/.+\.spec\.ts$/.test(path) ? path : null;
    } else if (file && line.startsWith("+") && SWITCHED_OFF.some((re) => re.test(line))) {
      found.push(`${file}: ${line.slice(1).trim()}`);
    }
  }
  return found;
}
