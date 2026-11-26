import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoard } from "./board-reads.ts";

// Fake reads that settle only when the test says so, to show what started when.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

test("the board's reads start before the study overview settles", async () => {
  const study = deferred<{ today: string }>();
  const started: string[] = [];
  const read =
    <T>(name: string, value: T) =>
    async () => {
      started.push(name);
      return value;
    };
  const board = readBoard(study.promise, {
    postings: read("postings", [{ company: "Example Ltd" }]),
    sources: read("sources", ["feed"]),
    evidence: read("evidence", []),
  });
  await tick();
  assert.deepEqual(started, ["postings", "sources", "evidence"]);

  study.resolve({ today: "2026-11-26" });
  const loaded = await board;
  assert.deepEqual(loaded, {
    overview: { today: "2026-11-26" },
    rows: [{ company: "Example Ltd" }],
    sources: ["feed"],
    evidence: [],
  });
});

test("a failed postings read rejects the board alone, and the study read still settles", async () => {
  const study = deferred<{ today: string }>();
  const board = readBoard(study.promise, {
    postings: () => Promise.reject(new Error("postings down")),
    sources: async () => [],
    evidence: async () => [],
  });
  study.resolve({ today: "2026-11-26" });
  await assert.rejects(board, /postings down/);
  assert.deepEqual(await study.promise, { today: "2026-11-26" });
});

test("a failed study read rejects the board without an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  const postings = deferred<string[]>();
  const board = readBoard(Promise.reject(new Error("study down")), {
    postings: () => postings.promise,
    sources: async () => [],
    evidence: async () => [],
  });
  await assert.rejects(board, /study down/);
  postings.reject(new Error("postings down too"));
  await tick();
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
});
