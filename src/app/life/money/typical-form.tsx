"use client";

import { useState } from "react";
import { useAction } from "../kit";
import { setCategoryBudget } from "./actions";

/**
 * A fixed cost counted at its typical month (no budget, no bill found): where the figure
 * came from, with one tap to save it as the category's budget, or a pounds field to change
 * it. Once saved it is a budget like any other, and the page no longer shows this.
 */
export function TypicalCost({
  categoryKey,
  name,
  amount,
  shown,
  text,
}: {
  categoryKey: string;
  name: string;
  /** The typical month in pounds, as the field takes it ("565.00"). */
  amount: string;
  /** The same, as the page shows money ("£565.00"). */
  shown: string;
  /** Where it came from: "Energy: £565.00 a month, the median of 4 months paid since June." */
  text: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(amount);
  const { pending, run } = useAction();
  const save = (pounds: string) =>
    void run(() => setCategoryBudget(categoryKey, pounds), `Saved: ${name} has a monthly budget now.`);
  const field = `typical-${categoryKey}`;

  return (
    <li className="space-y-2 px-3 py-2.5">
      <p className="text-sm text-body tabular-nums">{text}</p>
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(value);
          }}
        >
          <label className="block" htmlFor={field}>
            <span className="field-label">{name} a month (£)</span>
            <input
              id={field}
              className="field-input"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="btn-life px-3 py-1.5 text-xs"
              disabled={pending}
              aria-busy={pending}
              aria-label={`Save the budget for ${name}`}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-soft px-3 py-1.5 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-life px-3 py-1.5 text-xs"
            disabled={pending}
            aria-busy={pending}
            aria-label={`Use ${shown} a month for ${name}`}
            onClick={() => save(amount)}
          >
            Use {shown} a month
          </button>
          <button
            type="button"
            className="btn-soft px-3 py-1.5 text-xs"
            aria-label={`Change the figure for ${name}`}
            onClick={() => setEditing(true)}
          >
            Change
          </button>
        </div>
      )}
    </li>
  );
}
