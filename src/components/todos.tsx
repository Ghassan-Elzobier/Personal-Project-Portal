"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type FormEvent } from "react";
import { addTodo, moveTodo, removeTodo, setTodoDone } from "@/app/life/todos/actions";
import { ActionButton } from "@/app/life/kit";
import { addDays, shortDate } from "@/lib/dates/week";
import { parseTodo, TITLE_MAX, type Todo } from "@/lib/life/todos/todos";
import { Chip, DueDate } from "./ui";
import { toast } from "./toaster";

// Life's private to-dos: a row to tick off, move or delete (the To-dos page, Today
// and /design), the line that adds one, and the add sheet behind Life's + button.

const OPEN_EVENT = "portal:todo-add";

/** Opens the add sheet from anywhere, as Life's + does. */
export function openTodoAdd() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function TodoAddButton({ className }: { className: string }) {
  return (
    <button type="button" className={className} onClick={openTodoAdd}>
      <span aria-hidden>+</span> Add to-do
    </button>
  );
}

/** One to-do: a tick, its title and day, a move to today or tomorrow, and delete. */
export function TodoRow({ todo, today }: { todo: Todo; today: string }) {
  const [pending, start] = useTransition();
  const [done, showDone] = useOptimistic(todo.doneAt !== null);
  const tomorrow = addDays(today, 1);

  const undo = () =>
    start(async () => {
      const r = await setTodoDone(todo.gid, false);
      if (r.error !== undefined) toast(r.error, { tone: "error" });
    });
  const tick = () =>
    start(async () => {
      const next = !done;
      showDone(next);
      const r = await setTodoDone(todo.gid, next);
      if (r.error !== undefined) return void toast(r.error, { tone: "error" });
      if (next) toast("Ticked off.", { action: { label: "Undo", onClick: undo } });
    });
  const moveTo = (day: string, label: string) =>
    start(async () => {
      const r = await moveTodo(todo.gid, day);
      toast(r.error ?? `Moved to ${label}.`, r.error ? { tone: "error" } : {});
    });

  return (
    <li className="flex min-w-0 items-start gap-3 py-3">
      <button
        type="button"
        onClick={tick}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={done}
        aria-label={`Done: ${todo.title}`}
        className={`tap size-11 shrink-0 rounded-full text-sm font-bold ring-1 ${done ? "bg-mint text-primary ring-mint" : "bg-white/5 text-mint ring-mint/30"}`}
      >
        {done && <span aria-hidden>✓</span>}
      </button>
      <div className="min-w-0 flex-1 pt-2.5">
        <p className={`font-medium wrap-break-word ${done ? "text-muted line-through" : "text-bright"}`}>
          {todo.title}
        </p>
        {!done && (
          <p className="flex flex-wrap items-center gap-x-4 text-xs text-muted">
            <DueDate dueOn={todo.dueOn} today={today} />
            {todo.dueOn !== today && (
              <button
                type="button"
                disabled={pending}
                onClick={() => moveTo(today, "today")}
                className="min-h-11 cursor-pointer link"
              >
                Today
              </button>
            )}
            {todo.dueOn !== tomorrow && (
              <button
                type="button"
                disabled={pending}
                onClick={() => moveTo(tomorrow, "tomorrow")}
                className="min-h-11 cursor-pointer link"
              >
                Tomorrow
              </button>
            )}
          </p>
        )}
      </div>
      <ActionButton
        action={() => removeTodo(todo.gid)}
        confirm="Delete this to-do for good?"
        done="Deleted."
        label={`Delete ${todo.title}`}
        className="tap shrink-0 text-xl leading-none text-muted hover:text-white"
      >
        <span aria-hidden>×</span>
      </ActionButton>
    </li>
  );
}

/** The line that adds a to-do. A day at the end is its due day: "Cancel the trial by 24 dec". */
export function TodoAdd({
  today,
  autoFocus = false,
  onDone,
}: {
  today: string;
  autoFocus?: boolean;
  /** After an add, or Cancel: the sheet closes. */
  onDone?: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const parsed = parseTodo(text, today);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;
    start(async () => {
      const r = await addTodo(parsed.title, parsed.dueOn);
      if (r.error !== undefined) return void setError(r.error);
      setText("");
      setError(null);
      toast(r.todo.dueOn ? `Added, due ${shortDate(r.todo.dueOn)}.` : "Added.");
      onDone?.();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={id} className="field-label">
        New to-do
      </label>
      <div className="flex min-w-0 items-start gap-2">
        <input
          ref={input}
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={TITLE_MAX + 40}
          autoComplete="off"
          placeholder="Cancel the trial by 24 dec"
          className="field-input mt-0 min-w-0 flex-1"
        />
        <button disabled={pending || !parsed.title} aria-busy={pending} className="btn-life shrink-0 px-4 py-2">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs text-muted">
        {parsed.dueOn ? (
          <Chip tone="mint">Due {shortDate(parsed.dueOn)}</Chip>
        ) : (
          <span>End with a day: today, tomorrow, fri, 24 dec.</span>
        )}
        {onDone && (
          <button type="button" onClick={onDone} className="min-h-11 cursor-pointer px-2 text-muted hover:text-white">
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm text-coral" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** The add sheet that Life's + opens, on any page. */
export function TodoQuickAdd({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-primary/70 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a to-do"
        onKeyDown={(e) => e.key === "Escape" && close()}
        className="w-full max-w-xl space-y-2 rounded-2xl bg-pine p-5 shadow-2xl ring-1 ring-mint/20"
      >
        <TodoAdd today={today} autoFocus onDone={close} />
        <p className="text-xs text-muted">Only you see to-dos. They never become tasks, so mentors never see them.</p>
      </div>
    </div>
  );
}
