"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { gapLabel, nextReview, type Rating } from "@/lib/study/review";
import { rateReview } from "./actions";

export type DueReview = {
  gid: string;
  prompt: string;
  /** What to check the recall against, in the tutor's words. Cards from the book plans have none. */
  answer: string | null;
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
          Recall from memory <span className="text-sm font-normal text-body tabular-nums">{shown.length} due</span>
        </h2>
        <p className="text-sm text-body">
          Write it on blank paper before looking anything up, then check it and rate yourself honestly.
        </p>
      </div>
      <ul className="divide-y divide-white/10">
        {shown.slice(0, SHOWN).map((r) => (
          // Keyed to the card: whether its answer is showing belongs to this card and goes with it.
          <RecallCard key={r.gid} review={r} today={today} pending={pending} onRate={(rating) => rate(r.gid, rating)} />
        ))}
      </ul>
      {shown.length > SHOWN && <p className="text-xs text-body">{shown.length - SHOWN} more after these.</p>}
    </section>
  );
}

/**
 * One thing to recall. A card with an answer keeps it, and the ratings, behind
 * "Show answer": recall first, then check against the answer and rate. A card
 * with none is rated straight away, against the book.
 */
function RecallCard({
  review: r,
  today,
  pending,
  onRate,
}: {
  review: DueReview;
  today: string;
  pending: boolean;
  onRate: (rating: Rating) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const answer = useRef<HTMLDivElement>(null);
  // The button that showed the answer is gone once it shows. Focus moves to the answer,
  // so a keyboard or a screen reader reads it next and finds the ratings after it.
  useEffect(() => {
    if (revealed) answer.current?.focus();
  }, [revealed]);
  const rateable = !r.answer || revealed;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-56 flex-1">
        <p className="text-sm">{r.prompt}</p>
        <p className="flex flex-wrap gap-x-3 text-xs text-body">
          <Link href={r.sourceHref} scroll={false} className="underline-offset-4 hover:underline">
            {r.source}
          </Link>
          {r.bookHref && (
            <a href={r.bookHref} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
              Open the book
            </a>
          )}
        </p>
        {r.answer && revealed && (
          <div ref={answer} tabIndex={-1} className="mt-2 rounded-lg bg-white/5 px-3 py-2">
            <p className="text-xs text-muted">Answer</p>
            <p className="text-sm whitespace-pre-line">{r.answer}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rateable ? (
          (["got", "shaky", "missed"] as const).map((rating) => (
            <button
              key={rating}
              disabled={pending}
              aria-busy={pending}
              onClick={() => onRate(rating)}
              title={`Next: ${gapLabel(today, nextReview({ step: r.step, kind: r.kind, rating, today }).dueOn)}`}
              className="btn-ghost px-3 py-1 text-xs"
            >
              {rating === "got" ? "Got it" : rating === "shaky" ? "Shaky" : "Missed"}
            </button>
          ))
        ) : (
          <button onClick={() => setRevealed(true)} className="btn-ghost px-3 py-1 text-xs">
            Show answer
          </button>
        )}
      </div>
    </li>
  );
}
