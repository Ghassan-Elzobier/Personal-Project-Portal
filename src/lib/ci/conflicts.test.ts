import { test } from "node:test";
import assert from "node:assert/strict";
import { conflictedFiles, conflictMarker, shouldResolveConflict } from "./conflicts.ts";

// `git merge-tree --write-tree --name-only` prints the merged tree's id, then the
// conflicted paths, a blank line, and the merge messages.
const CONFLICTED =
  "9f3c1d2e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d\ndocs/factory/friction.md\nsrc/app/errors/page.tsx\n\nAuto-merging docs/factory/friction.md\nCONFLICT (content): Merge conflict in docs/factory/friction.md\n";
const CLEAN = "9f3c1d2e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d\n";

test("conflictedFiles reads the conflicted paths and nothing else", () => {
  assert.deepEqual(conflictedFiles(CONFLICTED), ["docs/factory/friction.md", "src/app/errors/page.tsx"]);
  assert.deepEqual(conflictedFiles(CLEAN), []);
  assert.deepEqual(conflictedFiles(""), []);
});

test("the marker names the head commit, so a pull request is told once per push", () => {
  assert.equal(conflictMarker("abc123"), "<!-- merge-conflict:abc123 -->");
});

test("a conflict is resolved by Claude only on the owner's own branches, twice at most", () => {
  const base = { branch: "claude/x", sameRepo: true, attempts: 0, labels: [] as string[], files: ["a.ts"] };
  assert.equal(shouldResolveConflict(base), true);
  assert.equal(shouldResolveConflict({ ...base, attempts: 2 }), false);
  assert.equal(shouldResolveConflict({ ...base, branch: "feature/x" }), false);
  assert.equal(shouldResolveConflict({ ...base, sameRepo: false }), false);
  assert.equal(shouldResolveConflict({ ...base, labels: ["no-autofix"] }), false);
  assert.equal(shouldResolveConflict({ ...base, files: [] }), false);
});
