import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The save tests tap through the app and change shared data. Where they live and
// how they run is set in playwright.config.ts; these checks hold it to what the
// rules tell agents (.claude/rules/tests.md): a new save test goes in a new
// e2e/state-<feature>.spec.ts, and those files run last, alone and one at a time.

const config = readFileSync(new URL("../../../playwright.config.ts", import.meta.url), "utf8");

const pattern = () => {
  const found = /^const STATE = \/(.+)\/;$/m.exec(config);
  assert.ok(found, "playwright.config.ts names the save tests in a STATE pattern");
  return new RegExp(found[1]);
};

/** One project's lines in the config, from its name to the end of its block. */
const project = (name: string) => {
  const found = new RegExp(`name: "${name}",[\\s\\S]*?\\n {4}\\},`).exec(config);
  assert.ok(found, `a project named ${name}`);
  return found[0];
};

test("a save test is any e2e/state-<feature>.spec.ts, and nothing else", () => {
  const state = pattern();
  for (const file of ["/work/e2e/state-fresh.spec.ts", "/work/e2e/state-gym-next.spec.ts", "e2e\\state-money.spec.ts"])
    assert.equal(state.test(file), true, file);
  for (const file of [
    "/work/e2e/pages.spec.ts",
    "/work/e2e/tasks-view.spec.ts",
    "/work/e2e/tutor-state-machine.spec.ts",
    "/work/e2e/__screenshots__/state-fresh.spec.ts/shot.png",
    "/work/e2e/state.ts",
  ])
    assert.equal(state.test(file), false, file);
});

test("the save tests run in one project, after every other suite and one file at a time", () => {
  const state = project("state");
  assert.match(state, /testMatch: STATE,/);
  assert.match(state, /workers: 1,/);
  assert.match(state, /dependencies: \["pixel-7", "small-phone", "desktop"\],/);
});

test("every other project leaves the save tests alone", () => {
  for (const name of ["pixel-7", "small-phone", "desktop"])
    assert.match(project(name), /testIgnore: (STATE|\[STATE, SHOTS\]),/, name);
});
