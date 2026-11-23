// When a build leaves no mark, its run log shows what Claude did, a line a step: the
// action hides the conversation, and its artifacts sit where some sessions can't reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { digest } from "./build.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("a build's transcript reads as what Claude said, each tool it called, the start of each result and how it ended", () => {
  const lines = digest([
    { type: "system", subtype: "init", model: "a-model" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll read the issue first." },
          { type: "tool_use", name: "Bash", input: { command: "gh issue view 7 --comments" } },
        ],
      },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", content: [{ type: "text", text: "title: Example\nbody" }] }] },
    },
    { type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(900) }] } },
    { type: "result", subtype: "success", num_turns: 5, result: "Done." },
  ]);
  assert.deepEqual(lines.slice(0, 3), [
    "Claude: I'll read the issue first.",
    '  Bash: {"command":"gh issue view 7 --comments"}',
    "    → title: Example body",
  ]);
  assert.equal(lines[3], `    → ${"x".repeat(400)}…`, "a long result is cut");
  assert.equal(lines[4], "Ended: success after 5 turns: Done.");
  assert.deepEqual(digest(null), []);
  assert.deepEqual(digest([null, 3, { type: "assistant" }]), []);
});

test("the check is handed the transcript, and prints it before failing", () => {
  const job = read(".github/workflows/rnd-build.yml").split(/^ {2}build:$/m)[1];
  assert.match(job, /^ {10}TRANSCRIPT: \$\{\{ steps\.build\.outputs\.execution_file \}\}$/m);
  const built = (read("scripts/rnd.mjs").split("function built()")[1] ?? "").split("const commands")[0];
  const shown = built.indexOf("digest(turns)");
  assert.ok(shown > 0 && shown < built.lastIndexOf("fail("), "the transcript is shown before the build fails");
});
