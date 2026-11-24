import { test } from "node:test";
import assert from "node:assert/strict";
import { onlyAppendsTests, protectedChanges } from "./test-additions.ts";

// One file's `git diff -U0`. New tests at the end of an existing test file are
// free, as the rules say; anything that changes the tests already there still
// needs the owner's label.

const FILE = "src/lib/example/sum.test.ts";
const diff = (...hunks: string[]) =>
  `diff --git a/${FILE} b/${FILE}\n--- a/${FILE}\n+++ b/${FILE}\n${hunks.join("\n")}\n`;
// An insertion after old line `after`, adding `lines`.
const insert = (after: number, ...lines: string[]) =>
  `@@ -${after},0 +${after + 1},${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`;

const NEW_TEST = ["", 'test("adds two made-up amounts", () => {', "  assert.equal(sum(2, 3), 5);", "});"];

test("a new test appended at the end of the file is allowed", () => {
  assert.equal(onlyAppendsTests(diff(insert(20, ...NEW_TEST)), 20), true);
});

test("a single-line import added inside the file, with a test at the end, is allowed", () => {
  assert.equal(onlyAppendsTests(diff(insert(2, 'import { sum } from "./sum.ts";'), insert(20, ...NEW_TEST)), 20), true);
});

test("helpers and groups appended at the end are allowed", () => {
  const lines = [
    "",
    "// A made-up week.",
    "function week(n: number) {",
    "  return n * 7;",
    "}",
    "const DAYS = week(1);",
    'describe("weeks", () => {',
    '  it("has seven days", () => assert.equal(DAYS, 7));',
    "});",
  ];
  assert.equal(onlyAppendsTests(diff(insert(20, ...lines)), 20), true);
});

test("a diff that deletes or changes an existing line is refused", () => {
  const deletes = "@@ -5 +4,0 @@\n-  assert.equal(sum(1, 1), 2);";
  const changes = "@@ -5 +5 @@\n-  assert.equal(sum(1, 1), 2);\n+  assert.ok(sum(1, 1));";
  assert.equal(onlyAppendsTests(diff(deletes), 20), false);
  assert.equal(onlyAppendsTests(diff(changes), 20), false);
  assert.equal(onlyAppendsTests(diff(changes, insert(20, ...NEW_TEST)), 20), false);
});

test("a line added inside the file that is not an import is refused", () => {
  assert.equal(onlyAppendsTests(diff(insert(6, "  assert.ok(true);")), 20), false);
  assert.equal(onlyAppendsTests(diff(insert(6, ...NEW_TEST)), 20), false);
  // A side-effect import, or one split over lines, is not a complete one-line import.
  assert.equal(onlyAppendsTests(diff(insert(2, 'import "./setup.ts";')), 20), false);
  assert.equal(onlyAppendsTests(diff(insert(2, "import {")), 20), false);
});

test("appended code that changes how existing tests run is refused", () => {
  const refused = [
    ["beforeEach(() => reset());"],
    ["test.beforeEach(async ({ page }) => page.goto('/'));"],
    ["after(() => close());"],
    ['test.only("focused", () => {});'],
    ['test("skipped", { skip: true }, () => {});'],
    ['test.skip("skipped", () => {});'],
    ['test.fixme("later", () => {});'],
    ["test.use({ viewport: { width: 360, height: 800 } });"],
    ['test.describe.configure({ mode: "serial" });'],
    ['mock.module("./sum.ts", {});'],
    ["shared.count = 2;"],
  ];
  for (const lines of refused)
    assert.equal(onlyAppendsTests(diff(insert(20, "", ...lines)), 20), false, lines.join("\n"));
});

test("an empty diff, or one with no newline at the end, is not an addition", () => {
  assert.equal(onlyAppendsTests("", 20), false);
  assert.equal(onlyAppendsTests(diff(insert(20, ...NEW_TEST), "\\ No newline at end of file"), 20), false);
});

test("the guard's filter lets appended unit tests and specs through, never screenshots or pgTAP", () => {
  const changes = [
    { status: "M", from: "src/lib/money/forecast.test.ts", to: "src/lib/money/forecast.test.ts" },
    { status: "M", from: "e2e/pages.spec.ts", to: "e2e/pages.spec.ts" },
    { status: "M", from: "e2e/__screenshots__/pixel-7/meals.png", to: "e2e/__screenshots__/pixel-7/meals.png" },
    { status: "M", from: "supabase/tests/01_access.test.sql", to: "supabase/tests/01_access.test.sql" },
    { status: "D", from: "src/lib/money/pace.test.ts", to: "src/lib/money/pace.test.ts" },
    { status: "R", from: "e2e/old.spec.ts", to: "e2e/new.spec.ts" },
    { status: "A", from: "src/lib/money/new.test.ts", to: "src/lib/money/new.test.ts" },
    { status: "M", from: "src/lib/money/forecast.ts", to: "src/lib/money/forecast.ts" },
  ];
  // Even if every file were judged an addition, only the unit test and spec pass.
  const { touched, addedTo } = protectedChanges(changes, () => true);
  assert.deepEqual(
    addedTo.map((c) => c.from),
    ["src/lib/money/forecast.test.ts", "e2e/pages.spec.ts"],
  );
  assert.deepEqual(
    touched.map((c) => c.from),
    [
      "e2e/__screenshots__/pixel-7/meals.png",
      "supabase/tests/01_access.test.sql",
      "src/lib/money/pace.test.ts",
      "e2e/old.spec.ts",
    ],
  );
  // A test file that is not only an addition still needs the label.
  assert.equal(protectedChanges(changes, () => false).touched.length, 6);
});
