import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, dueSoon, groupOf, groupTodos, isDay, parseTodo, type Todo } from "./todos.ts";

// 2026-11-16 is a Monday, the end-to-end suite's pinned day. Every to-do is made up.
const today = "2026-11-16";

const todo = (gid: number, title: string, dueOn: string | null, doneAt: string | null = null): Todo => ({
  gid: String(gid),
  title,
  dueOn,
  doneAt,
});

const late = todo(1, "Example late reply", "2026-11-13");
const now = todo(2, "Example call", today);
const soon = todo(3, "Example renewal check", "2026-11-17");
const later = todo(4, "Example form", "2026-12-24");
const someday = todo(5, "Example errand", null);
const done = todo(6, "Example done", today, "2026-11-16T08:00:00Z");
const doneEarlier = todo(7, "Example done earlier", null, "2026-11-14T18:00:00Z");

test("each to-do falls in one group by its day, and a ticked one is done whatever its day", () => {
  assert.deepEqual(
    [late, now, soon, later, someday, done].map((t) => groupOf(t, today)),
    ["overdue", "today", "tomorrow", "later", "someday", "done"],
  );
});

test("the page shows the groups in order, soonest first within each, and leaves empty ones out", () => {
  const sameDay = todo(8, "Example second call", today);
  const groups = groupTodos([someday, done, sameDay, later, now, late, doneEarlier], today);
  assert.deepEqual(
    groups.map((g) => [g.title, g.todos.map((t) => t.title)]),
    [
      ["Overdue", ["Example late reply"]],
      ["Today", ["Example call", "Example second call"]],
      ["Later", ["Example form"]],
      ["No day", ["Example errand"]],
      ["Done", ["Example done", "Example done earlier"]],
    ],
  );
});

test("Today gets only open to-dos that are overdue, due today or due tomorrow", () => {
  assert.deepEqual(
    dueSoon([later, soon, done, someday, now, late], today).map((t) => t.title),
    ["Example late reply", "Example call", "Example renewal check"],
  );
  assert.deepEqual(dueSoon([later, someday, done], today), []);
});

test("a line ending in a day is a title and a due day", () => {
  assert.deepEqual(parseTodo("Cancel trial tue", today), { title: "Cancel trial", dueOn: "2026-11-17" });
  assert.deepEqual(parseTodo("  Cancel the example trial by 24 dec ", today), {
    title: "Cancel the example trial",
    dueOn: "2026-12-24",
  });
  assert.deepEqual(parseTodo("Pay the example bill on fri", today), {
    title: "Pay the example bill",
    dueOn: "2026-11-20",
  });
  assert.deepEqual(parseTodo("Post the form tomorrow", today), { title: "Post the form", dueOn: "2026-11-17" });
});

test("a line with no day at the end keeps every word, and a lone day word is a title", () => {
  assert.deepEqual(parseTodo("Friday shop list", today), { title: "Friday shop list", dueOn: null });
  assert.deepEqual(parseTodo("Stand by", today), { title: "Stand by", dueOn: null });
  assert.deepEqual(parseTodo("tomorrow", today), { title: "tomorrow", dueOn: null });
  assert.deepEqual(parseTodo("by fri", today), { title: "by", dueOn: "2026-11-20" });
});

test("a title is trimmed and 1 to 200 characters", () => {
  assert.equal(cleanTitle("  Example errand "), "Example errand");
  assert.equal(cleanTitle("x".repeat(200)), "x".repeat(200));
  assert.equal(cleanTitle("x".repeat(201)), null);
  assert.equal(cleanTitle("   "), null);
  assert.equal(cleanTitle(42), null);
});

test("a day is a real date written YYYY-MM-DD", () => {
  assert.equal(isDay("2026-12-24"), true);
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("24 dec"), false);
  assert.equal(isDay(null), false);
});
