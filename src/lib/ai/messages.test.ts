import assert from "node:assert/strict";
import test from "node:test";
import { AiError, aiProblem, API_VERSION, askJson, jsonRequest, readReply, type JsonAsk } from "./messages.ts";

const ASK: JsonAsk = {
  model: "claude-haiku-5-5",
  system: "Read the made-up advert.",
  user: "<advert>1| Example role</advert>",
  schema: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
  maxTokens: 1000,
  effort: "low",
  thinking: "disabled",
};

const CONNECTION = { key: "made-up-key", base: "https://api.example.test" };

/** A stand-in for fetch that answers once and records the request. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetcher, calls };
}

const answer = (text: string, stop = "end_turn") => ({
  type: "message",
  role: "assistant",
  content: [{ type: "text", text }],
  stop_reason: stop,
});

const codeOf = async (run: () => Promise<unknown> | unknown) => {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof AiError, `expected an AiError, got ${String(e)}`);
    return e.code;
  }
  assert.fail("expected it to throw");
};

test("a request names the version and the key, holds the answer to the schema, and gives the model no tools", async () => {
  const { fetcher, calls } = fakeFetch(200, answer('{"title":"Example role"}'));
  assert.deepEqual(await askJson(ASK, CONNECTION, fetcher), { title: "Example role" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/v1/messages");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "made-up-key");
  assert.equal(headers["anthropic-version"], API_VERSION);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.max_tokens, 1000);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: ASK.schema });
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.tools, undefined);
  // API version 2026-10-21 refuses these outright.
  for (const removed of ["temperature", "top_p", "top_k"]) assert.equal(body[removed], undefined);
});

test("thinking is left to the model unless the caller turns it off", () => {
  assert.equal("thinking" in jsonRequest({ ...ASK, thinking: undefined }), false);
});

test("with no key nothing is sent", async () => {
  const { fetcher, calls } = fakeFetch(200, answer("{}"));
  assert.equal(await codeOf(() => askJson(ASK, { ...CONNECTION, key: null }, fetcher)), "NO_KEY");
  assert.equal(calls.length, 0);
});

test("the answer is read from the text block, wherever it sits", () => {
  const body = {
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: '{"title":"A"}' },
    ],
  };
  assert.deepEqual(readReply(200, body), { title: "A" });
});

test("an answer that is cut off, refused or not JSON is no answer, each with its own code", async () => {
  assert.equal(await codeOf(() => readReply(200, answer('{"title":', "max_tokens"))), "CUT_OFF");
  assert.equal(await codeOf(() => readReply(200, answer("", "refusal"))), "REFUSED");
  assert.equal(await codeOf(() => readReply(200, answer("not json"))), "BAD_REPLY");
  assert.equal(await codeOf(() => readReply(200, { content: [] })), "BAD_REPLY");
});

test("a spent credit balance, a bad key, a rate limit and an overload are told apart", async () => {
  const credit = {
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.",
    },
  };
  assert.equal(await codeOf(() => readReply(400, credit)), "NO_CREDIT");
  assert.equal(
    await codeOf(() => readReply(401, { error: { type: "authentication_error", message: "x" } })),
    "BAD_KEY",
  );
  assert.equal(await codeOf(() => readReply(429, { error: { type: "rate_limit_error" } })), "RATE_LIMITED");
  assert.equal(await codeOf(() => readReply(529, { error: { type: "overloaded_error" } })), "OVERLOADED");
  assert.equal(await codeOf(() => readReply(500, null)), "HTTP_500");
});

test("no failure passes on the API's own words", async () => {
  const { fetcher } = fakeFetch(400, { error: { type: "invalid_request_error", message: "secret detail" } });
  try {
    await askJson(ASK, CONNECTION, fetcher);
    assert.fail("expected it to throw");
  } catch (e) {
    assert.ok(e instanceof AiError);
    assert.equal(e.message, "AI:HTTP_400");
  }
});

test("a network failure and a timeout are codes too", async () => {
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(await codeOf(() => askJson(ASK, CONNECTION, down)), "NETWORK");
  const slow = (async () => {
    throw Object.assign(new Error("slow"), { name: "TimeoutError" });
  }) as typeof fetch;
  assert.equal(await codeOf(() => askJson(ASK, CONNECTION, slow)), "TIMEOUT");
  const garbled = fakeFetch(200, "<html>not json</html>").fetcher;
  assert.equal(await codeOf(() => askJson(ASK, CONNECTION, garbled)), "BAD_REPLY");
});

test("the owner is told what to do next, and the spent credit says it renews", () => {
  assert.match(aiProblem("NO_CREDIT"), /credit is spent.*renews/);
  assert.match(aiProblem("BAD_KEY"), /ANTHROPIC_API_KEY/);
  assert.match(aiProblem("HTTP_500"), /fill in the rest yourself/);
});
