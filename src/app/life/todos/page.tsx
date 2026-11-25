import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { loadTodos } from "@/lib/life/todos/operations";
import { groupTodos } from "@/lib/life/todos/todos";
import { Empty, ErrorNote } from "@/components/ui";
import { TodoAdd, TodoRow } from "@/components/todos";
import { LifeHeader } from "../parts";

export const metadata: Metadata = { title: "To-dos" };
export const dynamic = "force-dynamic";

// Personal admin, errands and deadlines, by the day each is due. Today shows the
// ones due by tomorrow; Claude adds and ticks them off too (list_life_todos).

export default async function TodosPage() {
  // Both start at once: life_read_todos checks for the owner itself.
  const [, loaded] = await Promise.all([requireOwner(), loadTodos()]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="To-dos" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const groups = groupTodos(loaded.todos, loaded.today);
  return (
    <div className="space-y-6">
      <LifeHeader eyebrow="Life" title="To-dos">
        Personal admin, errands and deadlines. Only you see them: they never become tasks, so mentors never do. Each one
        shows on Today from the day before it is due.
      </LifeHeader>

      <section aria-label="Add a to-do" className="card-life">
        <TodoAdd today={loaded.today} />
      </section>

      {groups.length === 0 ? (
        <Empty>Nothing to do. Add one above, or ask Claude to add one with the day it is due.</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`todos-${g.key}`} className="space-y-2">
            <h2 id={`todos-${g.key}`} className={`px-1 eyebrow ${g.key === "overdue" ? "text-coral" : ""}`}>
              {g.title} <span className="tabular-nums">{g.todos.length}</span>
            </h2>
            <ul className="divide-y divide-white/5 card-life py-1 sm:py-2">
              {g.todos.map((t) => (
                <TodoRow key={t.gid} todo={t} today={loaded.today} />
              ))}
            </ul>
            {g.key === "done" && <p className="px-1 text-xs text-muted">Ticked off in the last 7 days.</p>}
          </section>
        ))
      )}
    </div>
  );
}
