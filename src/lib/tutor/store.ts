import "server-only";
import { rpcAsCaller } from "../supabase/caller";
import type { Plan } from "./plan";
import type { NewReview } from "./reviews";

// The tutor tables, through their RPCs (supabase/migrations/20261116120000_tutor.sql).
// Browser calls use the session; connector calls prove themselves with their token.

export class TutorError extends Error {}

const READABLE = new Set(["42501", "P0002", "22023"]);

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpcAsCaller(name, args);
  if (error) {
    if (error.code === "PGRST202")
      throw new TutorError("The tutor tables are not in the database yet. Run the latest migration.");
    if (!READABLE.has(error.code)) console.error(name, error.code, error.message);
    throw new TutorError(
      READABLE.has(error.code)
        ? error.message
        : ["23514", "22P02"].includes(error.code)
          ? "Those values are not valid."
          : "The database did not answer. Try again in a minute.",
    );
  }
  return data as T;
}

export type SessionKind = "teach" | "practice";
export type AnswerKind = "probe" | "predict" | "check" | "recall" | "practice";

export type SessionRow = {
  gid: string;
  kind: SessionKind;
  task_gid: string | null;
  goal: string;
  status: "open" | "done" | "dropped";
  summary: string;
  created_at: string;
};
export type SessionSummary = SessionRow & {
  answers: number;
  checked: number;
  correct: number;
  confident_misses: number;
};
export type AnswerRow = {
  gid: string;
  kind: AnswerKind;
  question: string;
  options: unknown;
  answer: string;
  dont_know: boolean;
  correct: boolean | null;
  confidence: number | null;
  thinking: string;
  feedback: string;
  created_at: string;
};
export type ClaimRow = {
  gid: string;
  name: string;
  statement: string;
  task_gid?: string | null;
  session_gid?: string | null;
};
export type ChainRow = { gid: string; premises: number[]; conclusion: string };

export const startSession = (kind: SessionKind, task: string | null, goal: string) =>
  rpc<string>("tutor_start_session", { p_kind: kind, p_task: task === null ? null : Number(task), p_goal: goal });

export const savePlan = (session: string, plan: Plan) =>
  rpc<number>("tutor_set_plan", { p_session: Number(session), p_plan: plan });

export const saveAnswer = (
  session: string,
  a: {
    kind: AnswerKind;
    question: string;
    answer: string;
    dontKnow: boolean;
    correct: boolean | null;
    confidence: number | null;
    thinking: string;
    feedback: string;
    options: unknown;
  },
) =>
  rpc<string>("tutor_record_answer", {
    p_session: Number(session),
    p_kind: a.kind,
    p_question: a.question,
    p_answer: a.answer,
    p_dont_know: a.dontKnow,
    p_correct: a.correct,
    p_confidence: a.confidence,
    p_thinking: a.thinking,
    p_feedback: a.feedback,
    p_options: a.options ?? null,
  });

export const saveClaims = (
  session: string,
  claims: { key: string; name: string; statement: string }[],
  chains: { premises: string[]; conclusion: string }[],
) =>
  rpc<Record<string, number>>("tutor_save_claims", { p_session: Number(session), p_claims: claims, p_chains: chains });

export const endSession = (session: string, status: "done" | "dropped", summary: string, reviews: NewReview[]) =>
  rpc<number>("tutor_end_session", {
    p_session: Number(session),
    p_status: status,
    p_summary: summary,
    p_reviews: reviews,
  });

export const readSession = (session: string) =>
  rpc<{ session: SessionRow & { plan: Plan | null }; answers: AnswerRow[]; claims: ClaimRow[]; chains: ChainRow[] }>(
    "tutor_read",
    { p_session: Number(session), p_tasks: null },
  );

/** Recent sessions, and the claims and chains, of the given tasks (everything when null). */
export const readGraph = (tasks: string[] | null) =>
  rpc<{ sessions: SessionSummary[]; claims: ClaimRow[]; chains: ChainRow[] }>("tutor_read", {
    p_session: null,
    p_tasks: tasks === null ? null : tasks.map(Number),
  });
