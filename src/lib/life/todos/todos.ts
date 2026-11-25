// Private to-dos: personal admin, errands and deadlines, in the Life space. Only
// the owner sees them; they never become tasks, so mentors never do. Each has an
// optional day it is due by, and shows on Today from the day before.
// Pure, so it is tested with node's test runner. Saving is ./operations.ts, and
// Claude's tools are ./connector.ts.

import { addDays } from "../../dates/week.ts";
import { splitDue } from "../../tasks/quick-add.ts";

export type Todo = { gid: string; title: string; dueOn: string | null; doneAt: string | null };

/** The longest title the database takes (20261125134804_life_todos.sql). */
export const TITLE_MAX = 200;

export type TodoGroupKey = "overdue" | "today" | "tomorrow" | "later" | "someday" | "done";
export type TodoGroup = { key: TodoGroupKey; title: string; todos: Todo[] };

const GROUPS: readonly { key: TodoGroupKey; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "tomorrow", title: "Tomorrow" },
  { key: "later", title: "Later" },
  { key: "someday", title: "No day" },
  { key: "done", title: "Done" },
];

/** The groups Today shows: what is late, due today, or due tomorrow. */
const SOON: readonly TodoGroupKey[] = ["overdue", "today", "tomorrow"];

export function groupOf(todo: Todo, today: string): TodoGroupKey {
  if (todo.doneAt) return "done";
  if (!todo.dueOn) return "someday";
  if (todo.dueOn < today) return "overdue";
  if (todo.dueOn === today) return "today";
  return todo.dueOn === addDays(today, 1) ? "tomorrow" : "later";
}

// Soonest first, then in the order they were added. Done ones, last ticked first.
const byDay = (a: Todo, b: Todo) =>
  (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || Number(a.gid) - Number(b.gid);
const byDone = (a: Todo, b: Todo) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || Number(b.gid) - Number(a.gid);

/** Every to-do in its group, in the order the page shows them. Empty groups are left out. */
export function groupTodos(todos: readonly Todo[], today: string): TodoGroup[] {
  return GROUPS.map(({ key, title }) => ({
    key,
    title,
    todos: todos.filter((t) => groupOf(t, today) === key).sort(key === "done" ? byDone : byDay),
  })).filter((g) => g.todos.length > 0);
}

/** What Today shows: open to-dos that are overdue, due today or due tomorrow, soonest first. */
export function dueSoon(todos: readonly Todo[], today: string): Todo[] {
  return todos.filter((t) => SOON.includes(groupOf(t, today))).sort(byDay);
}

/**
 * A line such as "Cancel the trial by 24 dec": what to do, and the day it ends with.
 * The words for a day are the quick add's (today, tomorrow, fri, next fri, 24 dec,
 * 2026-12-24), and a "by" or "on" before the day goes with it.
 */
export function parseTodo(text: string, today: string): { title: string; dueOn: string | null } {
  const { name, dueOn } = splitDue(text.trim().split(/\s+/).filter(Boolean), today);
  const words = name.split(" ");
  if (dueOn && words.length > 1 && ["by", "on"].includes(words.at(-1)!.toLowerCase())) words.pop();
  return { title: words.join(" "), dueOn };
}

/** The title as saved: trimmed, and 1 to 200 characters. Null when there is no such title. */
export function cleanTitle(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const title = text.trim();
  return title.length >= 1 && title.length <= TITLE_MAX ? title : null;
}

/** A real day, written YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
