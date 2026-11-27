"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { ErrorNote } from "@/components/ui";
import type { Suggestion } from "@/lib/money/suggest";
import { setCategory, suggestCategories } from "./actions";

/**
 * Asks Claude where the unsorted merchants' payments belong, and takes each suggestion
 * with one tap, as "Always for this merchant": the same rule as sorting by hand, so it
 * sorts the merchant's other payments too. Nothing is sorted until a tap. `unsorted` is
 * the page's unsorted payments, so a suggestion goes as soon as its payment is sorted,
 * by a tap here, by a rule another tap saved, or by hand.
 */
export function SuggestSorts({ unsorted }: { unsorted: readonly number[] }) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [taken, setTaken] = useState<number[]>([]);
  const [asking, startAsking] = useTransition();
  const [sorting, startSorting] = useTransition();

  const take = (picked: Suggestion[]) =>
    startSorting(async () => {
      for (const s of picked) {
        const r = await setCategory(s.txnId, s.categoryId, true);
        if (r.error) return toast(r.error, { tone: "error" });
        setTaken((t) => [...t, s.txnId]);
      }
      toast(
        picked.length === 1
          ? `Sorted: ${picked[0].merchant} is ${picked[0].category} from now on.`
          : `Sorted ${picked.length} merchants.`,
      );
    });

  const open = new Set(unsorted);
  const left = (suggestions ?? []).filter((s) => !taken.includes(s.txnId) && open.has(s.txnId));
  return (
    <div className="space-y-3 rounded-xl bg-white/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 text-sm text-body">
          Claude can suggest where the unsorted merchants belong, from their names alone.
        </p>
        <button
          type="button"
          disabled={asking}
          aria-busy={asking}
          className="btn-soft shrink-0 px-3 py-1.5 text-xs"
          onClick={() =>
            startAsking(async () => {
              setProblem(null);
              const r = await suggestCategories();
              if (r.error !== undefined) return setProblem(r.error);
              setTaken([]);
              setSuggestions(r.suggestions);
            })
          }
        >
          {asking ? "Asking Claude…" : suggestions ? "Ask again" : "Suggest categories"}
        </button>
      </div>
      {problem && <ErrorNote message={problem} />}
      {suggestions && suggestions.length === 0 && (
        <p className="text-sm text-muted">
          Claude couldn&apos;t place any of them from their names. Tap a payment to sort it.
        </p>
      )}
      {left.length > 0 && (
        <>
          <ul aria-label="Suggested categories" className="divide-y divide-white/5">
            {left.map((s) => (
              <li key={s.txnId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{s.merchant}</span>
                  <span className="block text-xs text-muted">
                    {s.category}
                    {s.payments > 1 ? ` · ${s.payments} payments` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={sorting}
                  aria-busy={sorting}
                  aria-label={`Sort ${s.merchant} as ${s.category}`}
                  className="btn-life shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => take([s])}
                >
                  Sort
                </button>
              </li>
            ))}
          </ul>
          {left.length > 1 && (
            <button
              type="button"
              disabled={sorting}
              aria-busy={sorting}
              className="btn-soft px-3 py-1.5 text-xs"
              onClick={() => take(left)}
            >
              Sort all {left.length}
            </button>
          )}
          <p className="text-xs text-faint">
            Each is saved as always for that merchant, so its other payments are sorted too. Claude saw only the
            merchants&apos; names and whether money went in or out.
          </p>
        </>
      )}
    </div>
  );
}
