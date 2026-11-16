// What a session's answers say about the owner's understanding. Confidence is
// self-reported, so it is shown beside accuracy and never turned into a grade.

export type AnswerFacts = { correct: boolean | null; confidence: number | null; dontKnow: boolean };

export type SessionStats = {
  answers: number;
  /** Answers that were marked right or wrong (recall and explain answers may not be). */
  checked: number;
  correct: number;
  accuracy: number | null;
  /** Wrong while at least this sure: the surprises worth another look. */
  confidentMisses: number;
  dontKnow: number;
  /** Average confidence against actual accuracy over answers that have both; null if none. */
  calibration: { confidence: number; accuracy: number } | null;
};

export const CONFIDENT = 70;

export function summarize(answers: AnswerFacts[]): SessionStats {
  const checked = answers.filter((a) => a.correct !== null);
  const correct = checked.filter((a) => a.correct).length;
  const rated = checked.filter((a) => a.confidence !== null);
  return {
    answers: answers.length,
    checked: checked.length,
    correct,
    accuracy: checked.length ? correct / checked.length : null,
    confidentMisses: checked.filter((a) => a.correct === false && (a.confidence ?? 0) >= CONFIDENT).length,
    dontKnow: answers.filter((a) => a.dontKnow).length,
    calibration: rated.length
      ? {
          confidence: rated.reduce((sum, a) => sum + (a.confidence ?? 0), 0) / rated.length / 100,
          accuracy: rated.filter((a) => a.correct).length / rated.length,
        }
      : null,
  };
}

/** "3 of 4 right, 1 sure but wrong", or null when nothing was checked. */
export function describe(stats: Pick<SessionStats, "checked" | "correct" | "confidentMisses">): string | null {
  if (!stats.checked) return null;
  const base = `${stats.correct} of ${stats.checked} right`;
  return stats.confidentMisses ? `${base}, ${stats.confidentMisses} sure but wrong` : base;
}
