import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { expect, test } from "@playwright/test";

// What the deployed server functions carry, read from the build the suite runs
// against (npm run build, as Vercel builds it). The error tracker needs source
// maps on the server, but they must hold no source text, and no function may
// deploy the project's own files: a stray filesystem read once made Turbopack
// pack the whole project into every function (scripts/pack-source-maps.mjs).

const SERVER = ".next/server";
const INTAKE = join(SERVER, "app/api/errors/route.js.nft.json");

function traces(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "source-maps"
        ? []
        : traces(join(dir, e.name))
      : e.name.endsWith(".nft.json")
        ? [join(dir, e.name)]
        : [],
  );
}

const filesOf = (trace: string) =>
  (JSON.parse(readFileSync(trace, "utf8")).files as string[]).map((f) => normalize(join(dirname(trace), f)));

test.describe("the deployed functions", () => {
  // Build output, not a page: check it once.
  test.beforeEach(() => test.skip(test.info().project.name !== "pixel-7"));

  test("deploy none of the project's own files", () => {
    for (const trace of traces(SERVER)) {
      const own = filesOf(trace)
        .map((f) => relative(".", f))
        .filter(
          (f) => !f.startsWith(".next") && !f.startsWith("node_modules") && !f.startsWith("..") && f !== "package.json",
        );
      expect(own, trace).toEqual([]);
    }
  });

  test("give the error intake the source maps it needs, with no source text in them", () => {
    const maps = filesOf(INTAKE).filter((f) => f.endsWith(".map"));
    expect(maps.some((f) => f.includes("source-maps/static/"))).toBe(true);
    expect(maps.some((f) => f.includes("server/chunks"))).toBe(true);
    for (const map of maps) expect(readFileSync(map, "utf8"), map).not.toContain('"sourcesContent"');
  });
});
