// What a finished session adds to the recall queue. Claude chooses the claims
// worth keeping and writes each as a question; every check the owner got wrong
// comes back too, sooner. A card carries its answer when there is one (Claude's,
// for a question it chose; what it said about the mistake, for a miss), so the
// owner can check their recall against it. The queue's own spacing
// (study/review.ts) takes over once an item is rated.

export type NewReview = { prompt: string; days: number; answer?: string };

/** A check the owner got wrong: the question, and what Claude told them about it. */
type Miss = string | { question: string; feedback?: string };

const MAX_REVIEWS = 10;
const MAX_PROMPT = 500;
const MAX_ANSWER = 1000;
/** A claim to keep for good comes back in three days; a missed check tomorrow. */
export const CLAIM_DAYS = 3;
export const MISS_DAYS = 1;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** An answer keeps its line breaks: it may be a few short lines, and the card shows them as written. */
function tidyAnswer(text: string | undefined): string {
  const lines = (text ?? "").split("\n").map(clean);
  return clip(
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    MAX_ANSWER,
  );
}

export function reviewsFor(input: {
  chosen: { prompt: string; days?: number; answer?: string }[];
  misses: Miss[];
}): NewReview[] {
  const seen = new Set<string>();
  const out: NewReview[] = [];
  const add = (prompt: string, days: number, said?: string) => {
    const text = clip(clean(prompt), MAX_PROMPT);
    const key = text.toLowerCase();
    if (!text || seen.has(key) || out.length >= MAX_REVIEWS) return;
    seen.add(key);
    const answer = tidyAnswer(said);
    out.push(answer ? { prompt: text, days, answer } : { prompt: text, days });
  };
  // Misses first: a full queue should lose a keepsake before a mistake.
  for (const miss of input.misses) {
    const { question, feedback } = typeof miss === "string" ? { question: miss, feedback: undefined } : miss;
    add(`From memory: ${clean(question)}`, MISS_DAYS, feedback);
  }
  for (const c of input.chosen) add(c.prompt, Math.min(Math.max(Math.round(c.days ?? CLAIM_DAYS), 1), 30), c.answer);
  return out;
}
