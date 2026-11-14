import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceMap } from "node:module";
import { buildFile, sourcePath, symbolicateStack } from "./symbolicate.ts";

// Small hand-made source maps, shaped like the ones Turbopack writes. The
// segment "AAyCMA" maps the start of generated line 1 to line 42, column 7 of
// the first source; "AAAA" maps it to line 1, column 1.
const browserMap = new SourceMap({
  version: 3,
  sources: ["turbopack:///[project]/src/app/life/meal-card.tsx"],
  names: [],
  mappings: "AAyCMA",
} as never);
// An index map with sections, as Turbopack writes for some chunks.
const serverMap = new SourceMap({
  version: 3,
  sections: [
    {
      offset: { line: 0, column: 0 },
      map: { version: 3, sources: ["turbopack:///[turbopack]/runtime.ts"], names: [], mappings: "AAAA" },
    },
    {
      offset: { line: 10, column: 0 },
      map: { version: 3, sources: ["../../../../src/lib/life/store.ts"], names: [], mappings: "AAyCMA" },
    },
  ],
} as never);

const maps: Record<string, SourceMap> = {
  ".next/static/chunks/0abc.js": browserMap,
  ".next/server/chunks/ssr/app_life.js": serverMap,
};
const lookup = (file: string) => maps[file] ?? null;

test("buildFile finds the build file a frame points to, wherever the build sits", () => {
  assert.equal(
    buildFile("https://portal.example.test/_next/static/chunks/0abc.js?dpl=dpl_1"),
    ".next/static/chunks/0abc.js",
  );
  assert.equal(buildFile("/_next/static/chunks/0abc.js"), ".next/static/chunks/0abc.js");
  assert.equal(buildFile("/var/task/.next/server/chunks/ssr/app_life.js"), ".next/server/chunks/ssr/app_life.js");
  assert.equal(
    buildFile("file:///home/x/portal/.next/server/chunks/ssr/app_life.js"),
    ".next/server/chunks/ssr/app_life.js",
  );
  assert.equal(buildFile("node:internal/process/task_queues"), null);
  assert.equal(buildFile("/_next/static/../../secrets.js"), null);
});

test("sourcePath turns a map's source into a path in the repository", () => {
  assert.equal(sourcePath("turbopack:///[project]/src/app/life/meal-card.tsx"), "src/app/life/meal-card.tsx");
  assert.equal(sourcePath("../../../../src/lib/life/store.ts"), "src/lib/life/store.ts");
  assert.equal(sourcePath("../../../../node_modules/next/src/client/a.ts"), "node_modules/next/src/client/a.ts");
  assert.equal(sourcePath("turbopack:///[turbopack]/runtime.ts"), "[turbopack]/runtime.ts");
});

test("symbolicateStack maps browser and server frames back to source lines", () => {
  const stack = [
    "TypeError: Cannot read properties of undefined (reading 'title')",
    "    at a (https://portal.example.test/_next/static/chunks/0abc.js:1:1)",
    "    at loadMeals (/var/task/.next/server/chunks/ssr/app_life.js:11:1)",
    "    at https://portal.example.test/_next/static/chunks/0abc.js:1:1",
    "a@https://portal.example.test/_next/static/chunks/0abc.js:1:1",
  ].join("\n");
  assert.equal(
    symbolicateStack(stack, lookup),
    [
      "TypeError: Cannot read properties of undefined (reading 'title')",
      "    at src/app/life/meal-card.tsx:42:7",
      "    at loadMeals (src/lib/life/store.ts:42:7)",
      "    at src/app/life/meal-card.tsx:42:7",
      "@src/app/life/meal-card.tsx:42:7",
    ].join("\n"),
  );
});

test("symbolicateStack leaves a frame alone when there is no map or no mapping", () => {
  const stack = [
    "    at render (https://portal.example.test/_next/static/chunks/old.js:1:1)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
    "    at a (https://portal.example.test/_next/static/chunks/0abc.js:9:9)",
  ].join("\n");
  assert.equal(symbolicateStack(stack, lookup), stack);
  assert.equal(symbolicateStack("", lookup), "");
});

test("symbolicateStack survives a map that cannot be read", () => {
  const broken = () => {
    throw new Error("unreadable");
  };
  const stack = "    at a (https://portal.example.test/_next/static/chunks/0abc.js:1:1)";
  assert.equal(symbolicateStack(stack, broken), stack);
});
