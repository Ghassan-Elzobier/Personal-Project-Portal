// The Tasks page's own links. Each names the view it goes to, so a link never
// borrows the view you are on: the List link on the board once kept the board.

export type TasksView = "list" | "board";

/** A link to Tasks. The list is the default, so it leaves `view` out of the address. */
export function tasksHref({ project, view, task }: { project: string; view: TasksView; task?: string }): string {
  const q = new URLSearchParams({ project, ...(view === "board" ? { view } : {}), ...(task ? { task } : {}) });
  return `/tasks?${q}`;
}
