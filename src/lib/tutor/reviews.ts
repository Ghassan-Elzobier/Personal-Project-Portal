// What a finished session adds to the recall queue. Claude chooses the claims
// worth keeping and writes each as a question; every check the owner got wrong
// comes back too, sooner. The queue's own spacing (study/review.ts) takes over
// once an item is rated.

export type NewReview = { prompt: string; days: number };

const MAX_REVIEWS = 10;
const MAX_PROMPT = 500;
/** A claim to keep for good comes back in three days; a missed check tomorrow. */
export const CLAIM_DAYS = 3;
export const MISS_DAYS = 1;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string) => (text.length > MAX_PROMPT ? `${text.slice(0, MAX_PROMPT - 1).trimEnd()}…` : text);

export function reviewsFor(input: { chosen: { prompt: string; days?: number }[]; misses: string[] }): NewReview[] {
  const seen = new Set<string>();
  const out: NewReview[] = [];
  const add = (prompt: string, days: number) => {
    const text = clip(clean(prompt));
    const key = text.toLowerCase();
    if (!text || seen.has(key) || out.length >= MAX_REVIEWS) return;
    seen.add(key);
    out.push({ prompt: text, days });
  };
  // Misses first: a full queue should lose a keepsake before a mistake.
  for (const question of input.misses) add(`From memory: ${clean(question)}`, MISS_DAYS);
  for (const c of input.chosen) add(c.prompt, Math.min(Math.max(Math.round(c.days ?? CLAIM_DAYS), 1), 30));
  return out;
}
