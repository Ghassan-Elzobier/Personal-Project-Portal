"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { ErrorNote } from "@/components/ui";
import { splitDraft } from "@/lib/study/draft-answers";
import { gapLabel, nextReview, type Rating } from "@/lib/study/review";
import { draftReviewAnswers, rateReview } from "./actions";

export type DueReview = {
  gid: string;
  prompt: string;
  /**
   * What to check the recall against: the tutor's words, or Claude's draft (it starts
   * "Claude's draft: "). Cards from the book plans and those added by hand start with none.
   */
  answer: string | null;
  kind: string;
  step: number;
  source: string;
  sourceHref: string;
  bookHref: string | null;
};

const SHOWN = 6;

/** A missed card back for another try, counted so each try starts with its answer hidden again. */
type Again = { review: DueReview; round: number };

/**
 * What is due across every book, mixed together rather than one book at a time.
 * `canDraft`: the portal can ask Claude (src/lib/ai), so cards with no answer can get a draft.
 */
export function ReviewQueue({ due, today, canDraft = false }: { due: DueReview[]; today: string; canDraft?: boolean }) {
  const [pending, start] = useTransition();
  const [shown, remove] = useOptimistic(due, (list, gid: string) => list.filter((r) => r.gid !== gid));
  // Cards missed in this sitting, for one more try from memory after the rest. They have
  // left the due list, so this never copies live props; a reload clears it.
  const [again, setAgain] = useState<Again[]>([]);
  const drop = (gid: string) => setAgain((list) => list.filter((a) => a.review.gid !== gid));
  // Cards Claude left in this sitting, as it couldn't answer them from the question alone,
  // so the offer doesn't come back for them until a reload. Ids from the answer, not props.
  const [left, setLeft] = useState<string[]>([]);
  const bare = shown.filter((r) => !r.answer && !left.includes(r.gid)).length;

  const rate = (review: DueReview, rating: Rating) => {
    // Outside the transition, so the second try shows at once rather than when the save returns.
    if (rating === "missed") setAgain((list) => [...list, { review, round: 0 }]);
    start(async () => {
      remove(review.gid);
      const result = await rateReview(review.gid, rating);
      if (result.error) {
        drop(review.gid);
        toast(result.error, { tone: "error" });
      }
    });
  };

  const onceMore = again.length > 0 && (
    <OnceMore
      again={again}
      onGot={drop}
      onNotYet={(gid) =>
        setAgain((list) => {
          const card = list.find((a) => a.review.gid === gid);
          return card ? [...list.filter((a) => a !== card), { ...card, round: card.round + 1 }] : list;
        })
      }
    />
  );

  if (shown.length === 0) return onceMore || null;
  return (
    <>
      <section aria-labelledby="reviews-title" className="space-y-4 card">
        <div>
          <h2 id="reviews-title" className="text-lg font-semibold">
            Recall from memory <span className="text-sm font-normal text-body tabular-nums">{shown.length} due</span>
          </h2>
          <p className="text-sm text-body">
            Write it on blank paper before looking anything up, then check it and rate yourself honestly.
          </p>
        </div>
        {canDraft && bare > 0 && <DraftAnswers count={bare} onLeft={(gids) => setLeft((list) => [...list, ...gids])} />}
        <ul className="divide-y divide-white/10">
          {shown.slice(0, SHOWN).map((r) => (
            // Keyed to the card: whether its answer is showing belongs to this card and goes with it.
            <RecallCard key={r.gid} review={r} today={today} pending={pending} onRate={(rating) => rate(r, rating)} />
          ))}
        </ul>
        {shown.length > SHOWN && <p className="text-xs text-body">{shown.length - SHOWN} more after these.</p>}
      </section>
      {onceMore}
    </>
  );
}

/** What a draft run did, for the toast. */
function draftedNote(drafted: number, left: number): string {
  const cards = (n: number) => (n === 1 ? "1 card" : `${n} cards`);
  if (!drafted && !left) return "Every card due already has an answer.";
  if (!drafted)
    return `Claude couldn't answer ${left === 1 ? "it" : "them"} from the question alone, so check against the book.`;
  const done = `Drafted answers for ${cards(drafted)}. Recall first, then tap Show answer.`;
  return left ? `${done} Claude left ${cards(left)} it couldn't answer from the question alone.` : done;
}

/**
 * Offers Claude's drafts for the due cards that have nothing to check against. A draft
 * goes behind "Show answer" like the tutor's words, so recalling still comes first.
 */
function DraftAnswers({ count, onLeft }: { count: number; onLeft: (gids: string[]) => void }) {
  const [drafting, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="space-y-3 rounded-xl bg-white/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 text-sm text-body">
          {count === 1
            ? "1 card has no answer to check against. Claude can draft one from the question alone."
            : `${count} cards have no answer to check against. Claude can draft them from the questions alone.`}
        </p>
        <button
          type="button"
          disabled={drafting}
          aria-busy={drafting}
          className="btn-ghost min-h-11 shrink-0 px-4 text-sm"
          onClick={() =>
            start(async () => {
              setProblem(null);
              const result = await draftReviewAnswers();
              if (result.error !== undefined) return setProblem(result.error);
              const gids = result.left ?? [];
              onLeft(gids);
              toast(draftedNote(result.drafted ?? 0, gids.length));
            })
          }
        >
          {drafting ? "Drafting answers…" : "Draft answers"}
        </button>
      </div>
      {problem && <ErrorNote message={problem} />}
    </div>
  );
}

/**
 * The cards missed in this sitting, for one more try from memory once the others are
 * done. Practice only: tomorrow's review is already saved, so nothing here saves.
 */
function OnceMore({
  again,
  onGot,
  onNotYet,
}: {
  again: Again[];
  onGot: (gid: string) => void;
  onNotYet: (gid: string) => void;
}) {
  return (
    <section aria-labelledby="again-title" className="space-y-4 card">
      <div>
        <h2 id="again-title" className="text-lg font-semibold">
          Once more <span className="text-sm font-normal text-body tabular-nums">{again.length} to try</span>
        </h2>
        <p className="text-sm text-body">
          Missed, so back tomorrow. After the others, recall it once more before you stop. Nothing here is saved.
        </p>
      </div>
      <ul className="divide-y divide-white/10">
        {again.map(({ review, round }) => (
          // Keyed to the try as well as the card: a card sent to the back comes round with its answer hidden.
          <RecallCard
            key={`${review.gid}-${round}`}
            review={review}
            again={{ onGot: () => onGot(review.gid), onNotYet: () => onNotYet(review.gid) }}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One thing to recall. A card with an answer keeps it, and the ratings, behind
 * "Show answer": recall first, then check against the answer and rate. A card
 * with none is rated straight away, against the book. On a second try (`again`)
 * the ratings give way to "Got it now" and "Not yet", which save nothing.
 */
function RecallCard(
  props: { review: DueReview } & (
    | { today: string; pending: boolean; onRate: (rating: Rating) => void; again?: never }
    | { again: { onGot: () => void; onNotYet: () => void } }
  ),
) {
  const r = props.review;
  const [revealed, setRevealed] = useState(false);
  const answer = useRef<HTMLDivElement>(null);
  // The button that showed the answer is gone once it shows. Focus moves to the answer,
  // so a keyboard or a screen reader reads it next and finds the ratings after it.
  useEffect(() => {
    if (revealed) answer.current?.focus();
  }, [revealed]);
  const rateable = !r.answer || revealed;
  const shownAnswer = r.answer ? splitDraft(r.answer) : null;
  // The due list keeps its small buttons; a second try's are a full thumb's height.
  const button = props.again ? "btn-ghost min-h-12 px-4 text-sm" : "btn-ghost px-3 py-1 text-xs";

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
        {shownAnswer && revealed && (
          <div ref={answer} tabIndex={-1} className="mt-2 rounded-lg bg-white/5 px-3 py-2">
            <p className="text-xs text-muted">
              {shownAnswer.draft ? "Claude's draft, from the question alone: check it against the book" : "Answer"}
            </p>
            <p className="text-sm whitespace-pre-line">{shownAnswer.text}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!rateable ? (
          <button onClick={() => setRevealed(true)} className={button}>
            Show answer
          </button>
        ) : props.again ? (
          <>
            <button onClick={props.again.onGot} className={button}>
              Got it now
            </button>
            <button onClick={props.again.onNotYet} className={button}>
              Not yet
            </button>
          </>
        ) : (
          (["got", "shaky", "missed"] as const).map((rating) => (
            <button
              key={rating}
              disabled={props.pending}
              aria-busy={props.pending}
              onClick={() => props.onRate(rating)}
              title={`Next: ${gapLabel(props.today, nextReview({ step: r.step, kind: r.kind, rating, today: props.today }).dueOn)}`}
              className={button}
            >
              {rating === "got" ? "Got it" : rating === "shaky" ? "Shaky" : "Missed"}
            </button>
          ))
        )}
      </div>
    </li>
  );
}
