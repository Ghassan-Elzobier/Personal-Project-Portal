import assert from "node:assert/strict";
import { test } from "node:test";
import { toolsFor } from "./tools.ts";

test("the owner reaches Lessons from Work's More menu", () => {
  const learn = toolsFor("owner").find((t) => t.href === "/study/learn");
  assert.equal(learn?.title, "Lessons");
  assert.equal(learn?.space, "work");
  assert.equal(learn?.group, "more");
});

test("a mentor's nav has no link to the owner's lessons", () => {
  assert.ok(!toolsFor("mentor").some((t) => t.href.startsWith("/study/learn")));
});
