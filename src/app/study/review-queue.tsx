"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "@/components/toaster";
import { gapLabel, nextReview, type Rating } from "@/lib/study/review";
import { rateReview } from "./actions";

export type DueReview = {
  gid: string;
  prompt: string;
  kind: string;
  step: number;
  source: string;
  sourceHref: string;
  bookHref: string | null;
};

const SHOWN = 6;

/** What is due across every book, mixed together rather than one book at a time. */
export function ReviewQueue({ due, today }: { due: DueReview[]; today: string }) {
  const [pending, start] = useTransition();
  const [shown, remove] = useOptimistic(due, (list, gid: string) => list.filter((r) => r.gid !== gid));

  const rate = (gid: string, rating: Rating) =>
    start(async () => {
      remove(gid);
      const result = await rateReview(gid, rating);
      if (result.error) toast(result.error, { tone: "error" });
    });

  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="reviews-title" className="space-y-4 card">
      <div>
        <h2 id="reviews-title" className="text-lg font-semibold">
          Recall from memory{" "}
          <span className="text-sm font-normal text-neutral-300 tabular-nums">{shown.length} due</span>
        </h2>
        <p className="text-sm text-neutral-300">
          Write it on blank paper before looking anything up, then check it and rate yourself honestly.
        </p>
      </div>
      <ul className="divide-y divide-white/10">
        {shown.slice(0, SHOWN).map((r) => (
          <li key={r.gid} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-56 flex-1">
              <p className="text-sm">{r.prompt}</p>
              <p className="flex flex-wrap gap-x-3 text-xs text-neutral-300">
                <Link href={r.sourceHref} scroll={false} className="underline-offset-4 hover:underline">
                  {r.source}
                </Link>
                {r.bookHref && (
                  <a href={r.bookHref} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    Open the book
                  </a>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["got", "shaky", "missed"] as const).map((rating) => (
                <button
                  key={rating}
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() => rate(r.gid, rating)}
                  title={`Next: ${gapLabel(today, nextReview({ step: r.step, kind: r.kind, rating, today }).dueOn)}`}
                  className="btn-ghost px-3 py-1 text-xs"
                >
                  {rating === "got" ? "Got it" : rating === "shaky" ? "Shaky" : "Missed"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {shown.length > SHOWN && <p className="text-xs text-neutral-300">{shown.length - SHOWN} more after these.</p>}
    </section>
  );
}
