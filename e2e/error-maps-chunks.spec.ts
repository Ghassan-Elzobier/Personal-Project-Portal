import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Turbopack names a browser chunk's source map with a hash of its own, so the
// server can only find it if the build filed each map under its chunk's name
// (scripts/pack-source-maps.mjs). A check that guessed `<chunk>.js.map` once
// passed while every browser frame stayed minified; this reads the chunks.

const CHUNKS = ".next/static/chunks";
const PACKED = ".next/server/source-maps/static/chunks";

const mapNamedBy = (chunk: string) =>
  /\/\/# sourceMappingURL=(\S+)\s*$/.exec(readFileSync(join(CHUNKS, chunk), "utf8").slice(-1000))?.[1] ?? null;

test.describe("browser source maps", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "pixel-7"));

  test("every chunk's map is filed under the chunk's name, where the server looks", () => {
    const chunks = readdirSync(CHUNKS).filter((f) => f.endsWith(".js") && mapNamedBy(f));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(existsSync(join(PACKED, `${chunk}.map`)), chunk).toBe(true);
  });

  test("the map each chunk names is not served", async ({ request }) => {
    const chunks = readdirSync(CHUNKS).filter((f) => f.endsWith(".js") && mapNamedBy(f));
    for (const chunk of chunks.slice(0, 5)) {
      const response = await request.get(`/_next/static/chunks/${mapNamedBy(chunk)}`);
      expect(response.status(), chunk).toBe(404);
    }
  });
});
