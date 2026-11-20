import "server-only";
import { revalidatePath } from "next/cache";
import { parsePlan } from "./plan";
import { reviewsFor } from "./reviews";
import * as store from "./store";

// Every change the tutor makes, shared by the Claude connector now and by an
// in-portal tutor page later. Each returns { error } with a message for people
// instead of throwing.

export type Result<T = object> = ({ error?: undefined } & T) | { error: string };
type Json = Record<string, unknown>;

const GID = /^\d+$/;
const KEY = /^(?!\d+$)[a-z0-9-]{1,30}$/;

function refresh() {
  revalidatePath("/study");
  revalidatePath("/study/learn");
}

async function run<T>(change: () => Promise<T>): Promise<Result<{ value: T }>> {
  try {
    const value = await change();
    refresh();
    return { value };
  } catch (e) {
    if (e instanceof store.TutorError) return { error: e.message };
    throw e;
  }
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const gid = (v: unknown) => (typeof v === "string" && GID.test(v) ? v : null);

export async function startSession(input: Json): Promise<Result<{ session: string }>> {
  const kind = input.kind === "practice" ? "practice" : input.kind === "teach" ? "teach" : null;
  if (!kind) return { error: "Start a 'teach' or a 'practice' session." };
  const goal = text(input.goal, 500);
  if (!goal) return { error: "Say what the owner wants to understand." };
  const task = input.task_gid === undefined || input.task_gid === null ? null : gid(input.task_gid);
  if (input.task_gid !== undefined && input.task_gid !== null && !task)
    return { error: "task_gid is a number from get_study." };
  const result = await run(() => store.startSession(kind, task, goal));
  return result.error !== undefined ? result : { session: String(result.value) };
}

export async function setPlan(sessionGid: unknown, input: Json): Promise<Result<{ revision: number }>> {
  const session = gid(sessionGid);
  if (!session) return { error: "session is the number tutor_start returned." };
  const parsed = parsePlan({ nodes: input.nodes, edges: input.edges });
  if ("error" in parsed) return parsed;
  const result = await run(() => store.savePlan(session, parsed.plan));
  return result.error !== undefined ? result : { revision: result.value };
}

const ANSWER_KINDS = ["probe", "predict", "check", "recall", "practice"] as const;

export async function recordAnswer(sessionGid: unknown, input: Json): Promise<Result<{ answer: string }>> {
  const session = gid(sessionGid);
  if (!session) return { error: "session is the number tutor_start returned." };
  const kind = ANSWER_KINDS.find((k) => k === input.kind);
  if (!kind) return { error: "kind is probe, predict, check, recall or practice." };
  const question = text(input.question, 1000);
  if (!question) return { error: "Record the question that was asked." };
  const confidence = input.confidence === undefined || input.confidence === null ? null : Number(input.confidence);
  if (confidence !== null && !(Number.isInteger(confidence) && confidence >= 0 && confidence <= 100))
    return { error: "confidence is a whole number from 0 to 100." };
  const result = await run(() =>
    store.saveAnswer(session, {
      kind,
      question,
      answer: text(input.answer, 2000),
      dontKnow: input.dont_know === true,
      correct: typeof input.correct === "boolean" ? input.correct : null,
      confidence,
      thinking: text(input.thinking, 2000),
      feedback: text(input.feedback, 1000),
      options: Array.isArray(input.options) ? input.options.slice(0, 8) : null,
    }),
  );
  return result.error !== undefined ? result : { answer: String(result.value) };
}

export async function saveClaims(
  sessionGid: unknown,
  input: Json,
): Promise<Result<{ claims: Record<string, number> }>> {
  const session = gid(sessionGid);
  if (!session) return { error: "session is the number tutor_start returned." };
  const claims = list(input.claims).slice(0, 30).map(obj);
  const chains = list(input.chains).slice(0, 30).map(obj);
  if (!claims.length && !chains.length) return { error: "Save at least one claim or chain." };
  const cleanClaims: { key: string; name: string; statement: string }[] = [];
  for (const c of claims) {
    const key = typeof c.key === "string" ? c.key : "";
    if (!KEY.test(key))
      return { error: `A claim key is lowercase letters, digits and dashes (not only digits), not '${key}'.` };
    const name = text(c.name, 120);
    const statement = text(c.statement, 600);
    if (!name || !statement) return { error: `Claim '${key}' needs a name and a statement.` };
    cleanClaims.push({ key, name, statement });
  }
  const cleanChains: { premises: string[]; conclusion: string }[] = [];
  for (const h of chains) {
    const premises = list(h.premises).filter((p): p is string => typeof p === "string");
    if (premises.length < 1 || premises.length > 8) return { error: "A chain has 1 to 8 premises." };
    if (typeof h.conclusion !== "string" || !h.conclusion) return { error: "A chain needs a conclusion." };
    cleanChains.push({ premises, conclusion: h.conclusion });
  }
  const result = await run(() => store.saveClaims(session, cleanClaims, cleanChains));
  return result.error !== undefined ? result : { claims: result.value };
}

export async function endSession(sessionGid: unknown, input: Json): Promise<Result<{ reviews: number }>> {
  const session = gid(sessionGid);
  if (!session) return { error: "session is the number tutor_start returned." };
  const status = input.status === "dropped" ? "dropped" : input.status === "done" ? "done" : null;
  if (!status) return { error: "status is done or dropped." };
  const result = await run(async () => {
    // A check the owner got wrong comes back tomorrow without Claude having to ask,
    // and what Claude said about it then is the answer on its card.
    const record = await store.readSession(session);
    const misses = record.answers
      .filter((a) => a.correct === false && ["check", "recall", "practice"].includes(a.kind))
      .map((a) => ({ question: a.question, feedback: a.feedback }));
    const chosen = list(input.review_prompts)
      .map(obj)
      .map((r) => ({
        prompt: text(r.prompt, 500),
        days: typeof r.days === "number" ? r.days : undefined,
        answer: typeof r.answer === "string" ? r.answer : undefined,
      }));
    return store.endSession(session, status, text(input.summary, 2000), reviewsFor({ chosen, misses }));
  });
  return result.error !== undefined ? result : { reviews: result.value };
}
