import "server-only";
import { revalidatePath } from "next/cache";
import { timeZone } from "../../config/env";
import { now } from "../../dates/clock";
import { dateIn } from "../../dates/week";
import * as store from "../store";
import { cleanTitle, isDay, type Todo } from "./todos";

// Every change to the to-dos, shared by the pages' actions and Claude's tools
// (./connector.ts). Each answers { error } with a message for people rather than
// throwing, and no message repeats a title: errors can end up in public bug reports.

export type TodoResult = { todo: Todo; error?: undefined } | { error: string };
export type TodoChange = { title?: string; dueOn?: string | null; done?: boolean };

/** Ticked-off to-dos stay on the page this long, so a tick can be checked or taken back. */
const DONE_DAYS = 7;
const PAGES = ["/", "/life/todos"];

const NO_TITLE = "Write what to do, in up to 200 characters.";
const NO_DAY = "Pick a real day, or none.";
const GONE = "That to-do is not there any more.";

export async function loadTodos(): Promise<{ todos: Todo[]; today: string; error?: undefined } | { error: string }> {
  try {
    const since = new Date(now().getTime() - DONE_DAYS * 86_400_000).toISOString();
    return { todos: await store.readTodos(since), today: dateIn(now(), timeZone()) };
  } catch (e) {
    return {
      error: e instanceof store.LifeError ? e.message : "Your to-dos could not be read. Try again in a minute.",
    };
  }
}

async function save(change: () => Promise<Todo>): Promise<TodoResult> {
  try {
    const todo = await change();
    for (const page of PAGES) revalidatePath(page);
    return { todo };
  } catch (e) {
    return { error: e instanceof store.LifeError ? e.message : "That didn't save. Try again." };
  }
}

export async function addTodo(title: string, dueOn: string | null = null): Promise<TodoResult> {
  const clean = cleanTitle(title);
  if (!clean) return { error: NO_TITLE };
  if (dueOn !== null && !isDay(dueOn)) return { error: NO_DAY };
  return save(() => store.addTodo(clean, dueOn));
}

/** Changes only what is given: the title, the day (null for none), or whether it is done. */
export async function updateTodo(gid: string, change: TodoChange): Promise<TodoResult> {
  if (!/^\d+$/.test(gid)) return { error: GONE };
  const changes: { title?: string; due_on?: string | null; done?: boolean } = {};
  if (change.title !== undefined) {
    const clean = cleanTitle(change.title);
    if (!clean) return { error: NO_TITLE };
    changes.title = clean;
  }
  if (change.dueOn !== undefined) {
    if (change.dueOn !== null && !isDay(change.dueOn)) return { error: NO_DAY };
    changes.due_on = change.dueOn;
  }
  if (change.done !== undefined) changes.done = change.done;
  if (Object.keys(changes).length === 0) return { error: "Say what to change: the title, the day, or done." };
  return save(() => store.setTodo(gid, changes));
}

export async function removeTodo(gid: string): Promise<TodoResult> {
  if (!/^\d+$/.test(gid)) return { error: GONE };
  return save(() => store.removeTodo(gid));
}
