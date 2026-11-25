import "server-only";
import { err, ok, type Tool } from "../../mcp/tool";
import { addTodo, loadTodos, removeTodo, updateTodo, type TodoResult } from "./operations";
import { groupTodos, TITLE_MAX, type Todo } from "./todos";

// Claude's tools for the private to-dos: personal admin, errands and deadlines.
// Writes go through the same operations as the buttons. None of it reaches the
// tasks, so mentors never see it; study work stays create_task.

const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const TODO = {
  type: "string",
  pattern: "^\\d+$",
  description: "todo_gid, from list_life_todos, get_today or add_life_todo.",
};
const TITLE = { type: "string", minLength: 1, maxLength: TITLE_MAX, description: "What to do, in a few words." };

/** A to-do as Claude sees it. */
export const todoForClaude = (t: Todo) => ({
  todo_gid: t.gid,
  title: t.title,
  due_on: t.dueOn,
  done: t.doneAt !== null,
});

const page = (base: string) => `${base}/life/todos`;
const answer = (r: TodoResult, key: string, base: string) =>
  r.error !== undefined ? err(r.error) : ok({ [key]: todoForClaude(r.todo), page: page(base) });

export const TODO_TOOLS: Tool[] = [
  {
    name: "list_life_todos",
    title: "Private to-dos",
    description:
      "The owner's private to-dos (personal admin, errands, deadlines), open ones grouped by day (overdue, today, tomorrow, later, no day), then those ticked off in the last 7 days, each with its todo_gid. Only the owner sees them. Study work is tasks: list_tasks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(_args, { base }) {
      const loaded = await loadTodos();
      if (loaded.error !== undefined) return err(loaded.error);
      return ok({
        today: loaded.today,
        groups: groupTodos(loaded.todos, loaded.today).map((g) => ({
          group: g.title,
          todos: g.todos.map(todoForClaude),
        })),
        page: page(base),
      });
    },
  },
  {
    name: "add_life_todo",
    title: "Add a private to-do",
    description:
      "Adds a private to-do: personal admin, an errand or a deadline, such as cancelling a free trial before it renews. Give due_on, the day it must be done by: it shows on Today from the day before until it is ticked off. Only the owner sees it; it never becomes a task, so mentors never see it. Study work is create_task.",
    inputSchema: {
      type: "object",
      properties: {
        title: TITLE,
        due_on: { ...DAY, description: "The day it must be done by, YYYY-MM-DD. Leave out for no day." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, { base }) {
      const due = typeof args.due_on === "string" ? args.due_on : null;
      return answer(await addTodo(String(args.title), due), "added", base);
    },
  },
  {
    name: "update_life_todo",
    title: "Change a private to-do",
    description:
      "Ticks a private to-do off (done true) or puts it back (done false), moves it to another day (due_on, or null for no day), or renames it (title). Only what is given changes. Returns the to-do as saved.",
    inputSchema: {
      type: "object",
      properties: {
        todo_gid: TODO,
        done: { type: "boolean", description: "True when it is done, false to put it back." },
        due_on: { anyOf: [DAY, { type: "null" }], description: "The new day, YYYY-MM-DD, or null for no day." },
        title: TITLE,
      },
      required: ["todo_gid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, { base }) {
      const r = await updateTodo(String(args.todo_gid), {
        title: typeof args.title === "string" ? args.title : undefined,
        dueOn: args.due_on === null ? null : typeof args.due_on === "string" ? args.due_on : undefined,
        done: typeof args.done === "boolean" ? args.done : undefined,
      });
      return answer(r, "saved", base);
    },
  },
  {
    name: "remove_life_todo",
    title: "Delete a private to-do",
    description:
      "Deletes a private to-do for good, such as one added by mistake. To finish one, call update_life_todo with done true instead.",
    inputSchema: {
      type: "object",
      properties: { todo_gid: TODO },
      required: ["todo_gid"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async run(args, { base }) {
      return answer(await removeTodo(String(args.todo_gid)), "deleted", base);
    },
  },
];
