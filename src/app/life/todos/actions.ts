"use server";

import { requireOwner } from "@/lib/auth/access";
import * as ops from "@/lib/life/todos/operations";

// The to-do buttons, on the To-dos page, on Today and behind Life's add button.
// Each checks for the owner, then runs the shared operation.

export async function addTodo(title: string, dueOn: string | null) {
  await requireOwner();
  return ops.addTodo(title, dueOn);
}

export async function setTodoDone(gid: string, done: boolean) {
  await requireOwner();
  return ops.updateTodo(gid, { done: done === true });
}

export async function moveTodo(gid: string, dueOn: string | null) {
  await requireOwner();
  return ops.updateTodo(gid, { dueOn });
}

export async function removeTodo(gid: string) {
  await requireOwner();
  return ops.removeTodo(gid);
}
