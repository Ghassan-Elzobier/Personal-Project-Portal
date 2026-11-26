import { test } from "node:test";
import assert from "node:assert/strict";
import { readWeek, type WeekReads } from "./week-reads.ts";

// Fake reads that settle only when the test says so, to show what started when.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setImmediate(r));

type Connection = { email: string };
const connected: Connection = { email: "owner@example.test" };

function reads(over: Partial<WeekReads<string[], Connection, string>> = {}) {
  return {
    tasks: async () => ["task"],
    googleConfigured: () => true,
    connection: async () => connected,
    events: async () => ["event"],
    ...over,
  } satisfies WeekReads<string[], Connection, string>;
}

test("the calendar read starts before the task reads settle", async () => {
  const tasks = deferred<string[]>();
  const started: string[] = [];
  const week = readWeek(
    reads({
      tasks: () => tasks.promise,
      connection: async () => {
        started.push("connection");
        return connected;
      },
      events: async () => {
        started.push("events");
        return ["event"];
      },
    }),
  );
  await tick();
  assert.deepEqual(started, ["connection", "events"]);

  tasks.resolve(["task"]);
  assert.deepEqual(await week, { tasks: ["task"], calendar: { connection: connected, events: ["event"] } });
});

test("a failing calendar read still returns the week, with the error for the Google state", async () => {
  const week = await readWeek(reads({ events: () => Promise.reject(new Error("Google is down")) }));
  assert.deepEqual(week.tasks, ["task"]);
  assert.ok(typeof week.calendar === "object" && "error" in week.calendar);
  assert.equal(week.calendar.connection, connected);
  assert.match(String(week.calendar.error), /Google is down/);
});

test("no calendar read when Google is not set up or not connected", async () => {
  let asked = 0;
  const events = async () => {
    asked++;
    return ["event"];
  };
  assert.equal((await readWeek(reads({ googleConfigured: () => false, events }))).calendar, "not-configured");
  assert.equal((await readWeek(reads({ connection: async () => null, events }))).calendar, "not-connected");
  assert.equal(asked, 0);
});

test("a failed task read rejects the week without an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  const connection = deferred<Connection | null>();
  const week = readWeek(
    reads({ tasks: () => Promise.reject(new Error("tasks down")), connection: () => connection.promise }),
  );
  await assert.rejects(week, /tasks down/);
  connection.resolve(connected);
  await tick();
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
});
