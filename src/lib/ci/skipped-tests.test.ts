import { test } from "node:test";
import assert from "node:assert/strict";
import { addedSkips } from "./skipped-tests.ts";

// `git diff -U0` of the end-to-end specs. A test marked fixme, skipped outright
// or focused is a way to get green without fixing anything, so it needs the
// owner's say-so, even in a test that is new on the branch.

const diff = (file: string, ...added: string[]) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,0 +1,${added.length} @@\n${added.map((l) => `+${l}`).join("\n")}\n`;

test("fixme, focus and unconditional skips in a spec are found", () => {
  const found = addedSkips(
    diff(
      "e2e/pages.spec.ts",
      '  test.fixme("opens", async () => {});',
      '  test.only("opens", async () => {});',
      '  test.skip("opens", async () => {});',
      "  test.skip();",
      '  describe.skip("group", () => {});',
      '  xtest("opens", async () => {});',
    ),
  );
  assert.equal(found.length, 6);
  assert.match(found[0], /^e2e\/pages\.spec\.ts: /);
});

test("a conditional skip, which names its reason in code, is allowed", () => {
  assert.deepEqual(
    addedSkips(
      diff(
        "e2e/x.spec.ts",
        '  test.skip(test.info().project.name !== "pixel-7");',
        "  test.skip(!process.env.CI, 'ci only');",
      ),
    ),
    [],
  );
});

test("only specs are looked at, and only added lines", () => {
  assert.deepEqual(addedSkips(diff("src/lib/a.test.ts", '  test.skip("x", () => {});')), []);
  assert.deepEqual(
    addedSkips("diff --git a/e2e/a.spec.ts b/e2e/a.spec.ts\n+++ b/e2e/a.spec.ts\n-  test.fixme('x', () => {});\n"),
    [],
  );
  assert.deepEqual(addedSkips(""), []);
});
