import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { demoFor, drawingFiles } from "./media.ts";
import { EXERCISE_MAP, PROGRAM } from "./program.ts";

test("every drawing a demo points at is in public/exercises", () => {
  for (const f of drawingFiles())
    assert.ok(existsSync(new URL(`../../../../public/exercises/${f}`, import.meta.url)), f);
});

test("every exercise in the programme has a demo video link, and the main lifts have drawings", () => {
  const used = PROGRAM.workouts.flatMap((w) => w.blocks.flatMap((b) => b.items.map((p) => p.exercise)));
  for (const key of used) {
    const d = demoFor(EXERCISE_MAP.get(key)!);
    assert.match(d.video, /^https:\/\/www\.youtube\.com\/results\?search_query=.+&sp=/);
  }
  for (const key of ["bench", "paused-bench", "close-grip-bench", "back-squat", "pull-up", "incline-db"])
    assert.ok(demoFor(EXERCISE_MAP.get(key)!).frames, key);
});
