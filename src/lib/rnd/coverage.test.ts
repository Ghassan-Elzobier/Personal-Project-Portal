import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../config/tools.ts";
import { FOCI } from "./foci.ts";

// Design, navigation, performance and one portal read every page: how it looks,
// loads and fits in. This holds that each tool in the nav also has a focus that
// asks whether it does its job, so a new tool cannot arrive without one.
test("every tool in the nav is some focus's own page", () => {
  const own = new Set(FOCI.flatMap((f) => f.pages ?? []));
  // The catalogue is the yardstick of the design focus, which reads every page.
  const tools = TOOLS.map((t) => t.href).filter((href) => href !== "/design");
  assert.deepEqual(
    tools.filter((href) => !own.has(href)),
    [],
    "add each of these to a focus's pages in src/lib/rnd/foci.ts, or give it a focus",
  );
});
