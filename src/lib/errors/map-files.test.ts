import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFile, mapFiles } from "./symbolicate.ts";

// Where the server looks for a frame's source map. The browser's maps are never
// public: the build packs them into .next/server/source-maps.

test("mapFiles looks for a browser chunk's map where the build packed it", () => {
  assert.deepEqual(mapFiles(".next/static/chunks/0abc.js"), [".next/server/source-maps/static/chunks/0abc.js.map"]);
});

test("mapFiles also tries without Vercel's /immutable/ prefix, which the build may not have", () => {
  const file = buildFile("https://portal.example.test/_next/static/immutable/chunks/0abc.js");
  assert.equal(file, ".next/static/immutable/chunks/0abc.js");
  assert.deepEqual(mapFiles(file!), [
    ".next/server/source-maps/static/immutable/chunks/0abc.js.map",
    ".next/server/source-maps/static/chunks/0abc.js.map",
  ]);
});

test("mapFiles looks beside a server chunk for its map", () => {
  assert.deepEqual(mapFiles(".next/server/chunks/ssr/app_life.js"), [".next/server/chunks/ssr/app_life.js.map"]);
});
