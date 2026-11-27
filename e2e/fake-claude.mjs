// A made-up Claude API for the end-to-end suite, so no test ever reaches the real one
// or spends credit. It answers POST /v1/messages in the Messages API's shape. Each
// feature that asks Claude has its own answer in e2e/fake-claude/, picked by the JSON
// schema the request holds the answer to (each module exports `matches` and
// `answer`), so a new feature adds a file there and changes nothing here. Like the
// portal's rules, it refuses a request that offers the model tools or no schema.
// POST /__credit?spent=1 makes it answer as the real API does once the month's credit
// is spent; ?spent=0 puts it back. Playwright starts it beside the app
// (playwright.config.ts), and scripts/e2e-env.sh points the app at it.
import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.FAKE_CLAUDE_PORT ?? 3198);
const KEY = process.env.ANTHROPIC_API_KEY || "e2e-made-up-key";
const DIR = fileURLToPath(new URL("./fake-claude/", import.meta.url));
const ANSWERS = await Promise.all(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort()
    .map((f) => import(pathToFileURL(DIR + f).href)),
);

let spent = false;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const refuse = (res, status, type, message) => send(res, status, { type: "error", error: { type, message } });

const readBody = (req) =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/__credit") {
    spent = url.searchParams.get("spent") === "1";
    return send(res, 204);
  }
  if (req.method !== "POST" || url.pathname !== "/v1/messages") return send(res, 404, { error: "not found" });
  if (req.headers["x-api-key"] !== KEY) return refuse(res, 401, "authentication_error", "invalid x-api-key");
  if (!req.headers["anthropic-version"]) return refuse(res, 400, "invalid_request_error", "anthropic-version");
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return refuse(res, 400, "invalid_request_error", "json");
  }
  if (body.tools !== undefined || body.output_config?.format?.type !== "json_schema")
    return refuse(res, 400, "invalid_request_error", "tools or schema");
  if (spent)
    return refuse(
      res,
      400,
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    );
  const fake = ANSWERS.find((a) => a.matches(body));
  if (!fake) return refuse(res, 400, "invalid_request_error", "no made-up answer for this schema");
  const user = typeof body.messages?.[0]?.content === "string" ? body.messages[0].content : "";
  return send(res, 200, {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text: JSON.stringify(await fake.answer(user, body)) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}).listen(PORT, () => console.log(`Fake Claude API on http://localhost:${PORT}`));
