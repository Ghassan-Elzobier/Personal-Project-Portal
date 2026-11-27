// The Claude API (Anthropic's Messages API), asked for one answer as JSON that
// matches a schema. Pure apart from the fetcher it is given, so it is tested with a
// fake one; src/lib/ai/claude.ts gives it the key and the real fetch.
//
// The API runs on the Max plan's monthly credit, and stops when that is spent. So
// every caller must work without it: failures become codes (AI:NO_CREDIT), never the
// API's own words, and no prompt or answer is ever logged, since what Claude reads
// may be personal. The caller gives the model no tools: its answer is data that the
// caller checks before using it.

/** The API version every request names (https://platform.claude.com/docs/en/api/versioning). */
export const API_VERSION = "2026-10-21";

const TIMEOUT_MS = 40_000;

export type AiCode =
  | "NO_KEY"
  | "BAD_KEY"
  | "NO_CREDIT"
  | "RATE_LIMITED"
  | "OVERLOADED"
  | "TIMEOUT"
  | "NETWORK"
  | "REFUSED"
  | "CUT_OFF"
  | "BAD_REPLY"
  | `HTTP_${number}`;

/** A request that failed, as a code only: production errors become public issues. */
export class AiError extends Error {
  readonly code: AiCode;
  constructor(code: AiCode) {
    super(`AI:${code}`);
    this.name = "AiError";
    this.code = code;
  }
}

/** A JSON schema in the subset structured outputs accept (every object closed). */
export type JsonSchema = { [key: string]: unknown };

export type JsonAsk = {
  model: string;
  system: string;
  user: string;
  schema: JsonSchema;
  /** A hard cap on the answer, thinking included. */
  maxTokens: number;
  effort: "low" | "medium" | "high";
  /** Haiku 5.5 can answer without thinking at high effort or below; Sonnet and Opus 5.5 refuse "disabled". */
  thinking?: "disabled";
};

export type Connection = { key: string | null; base: string };

/** The request body: one user turn, no tools, the answer held to the schema. */
export function jsonRequest(ask: JsonAsk) {
  return {
    model: ask.model,
    max_tokens: ask.maxTokens,
    system: ask.system,
    messages: [{ role: "user", content: ask.user }],
    ...(ask.thinking ? { thinking: { type: ask.thinking } } : {}),
    output_config: { effort: ask.effort, format: { type: "json_schema", schema: ask.schema } },
  };
}

type Reply = {
  stop_reason?: string;
  content?: { type?: string; text?: unknown }[];
  error?: { type?: string; message?: unknown };
};

/** The JSON Claude answered with, or the code for why there is none. */
export function readReply(status: number, body: unknown): unknown {
  const reply = (body ?? {}) as Reply;
  if (status === 200) {
    if (reply.stop_reason === "refusal") throw new AiError("REFUSED");
    if (reply.stop_reason === "max_tokens") throw new AiError("CUT_OFF");
    const text = reply.content?.find((b) => b.type === "text")?.text;
    if (typeof text !== "string") throw new AiError("BAD_REPLY");
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError("BAD_REPLY");
    }
  }
  const message = typeof reply.error?.message === "string" ? reply.error.message : "";
  // The API names a spent balance in its message, whichever status carries it.
  if (/credit balance/i.test(message)) throw new AiError("NO_CREDIT");
  if (status === 401) throw new AiError("BAD_KEY");
  if (status === 429) throw new AiError("RATE_LIMITED");
  if (status === 529 || reply.error?.type === "overloaded_error") throw new AiError("OVERLOADED");
  throw new AiError(`HTTP_${status}`);
}

/** Asks Claude once and returns its JSON. Throws AiError; never retries, so a tap costs one call. */
export async function askJson(ask: JsonAsk, connection: Connection, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!connection.key) throw new AiError("NO_KEY");
  let res: Response;
  try {
    res = await fetcher(`${connection.base}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": connection.key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(jsonRequest(ask)),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new AiError(e instanceof Error && e.name === "TimeoutError" ? "TIMEOUT" : "NETWORK");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new AiError("BAD_REPLY");
  }
  return readReply(res.status, body);
}

/** What the owner is told when Claude could not help, worded as what to do next. */
export function aiProblem(code: AiCode): string {
  switch (code) {
    case "NO_KEY":
      return "Claude isn't set up for the portal (ANTHROPIC_API_KEY), so fill in the rest yourself.";
    case "BAD_KEY":
      return "The Claude API refused the portal's key. Check ANTHROPIC_API_KEY in Vercel; fill in the rest yourself for now.";
    case "NO_CREDIT":
      return "This month's Claude API credit is spent, so fill in the rest yourself. It renews with the plan.";
    case "RATE_LIMITED":
    case "OVERLOADED":
      return "Claude is busy just now. Try again in a minute, or fill in the rest yourself.";
    case "TIMEOUT":
    case "NETWORK":
      return "Claude didn't answer in time. Try again, or fill in the rest yourself.";
    default:
      return "Claude couldn't read this one, so fill in the rest yourself.";
  }
}
