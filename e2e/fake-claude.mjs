// A made-up Claude API for the end-to-end suite, so no test ever reaches the real one
// or spends credit. It answers POST /v1/messages in the Messages API's shape, reading a
// made-up advert's "Role:", "Employer:", "Location:", "Salary:" and "Closing date:"
// lines the way Claude would, and naming every line as the advert except the site's
// menus, cookie notice and other jobs. Like the portal's rules, it refuses a request
// that offers the model tools or no schema. POST /__credit?spent=1 makes it answer as
// the real API does once the month's credit is spent; ?spent=0 puts it back.
// Playwright starts it beside the app (playwright.config.ts), and scripts/e2e-env.sh
// points the app at it.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_CLAUDE_PORT ?? 3198);
const KEY = process.env.ANTHROPIC_API_KEY || "e2e-made-up-key";
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const NOT_THE_ADVERT = /^(?:home\b|we use cookies|similar jobs)/i;

let spent = false;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
  });

/** "30 November 2026" or "2026-11-30" as YYYY-MM-DD. */
function dayOf(text) {
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  const m = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/i.exec(text);
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return month < 0 ? "" : `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** The answer Claude would give for a made-up advert, from its numbered lines. */
function answerFor(user) {
  const block = /<advert>\n([\s\S]*)\n<\/advert>/.exec(user)?.[1] ?? "";
  const lines = block.split("\n").map((l) => {
    const m = /^(\d+)\| ?(.*)$/.exec(l);
    return { n: Number(m?.[1] ?? 0), text: m?.[2] ?? "" };
  });
  const value = (label) =>
    lines
      .find((l) => l.text.toLowerCase().startsWith(`${label.toLowerCase()}:`))
      ?.text.slice(label.length + 1)
      .trim() ?? "";
  const title = value("Role");
  return {
    is_job_advert: title !== "",
    title,
    employer: value("Employer"),
    location: value("Location"),
    salary: value("Salary"),
    closing_date: dayOf(value("Closing date")),
    advert_lines: lines.filter((l) => l.n > 0 && !NOT_THE_ADVERT.test(l.text)).map((l) => ({ first: l.n, last: l.n })),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/__credit") {
    spent = url.searchParams.get("spent") === "1";
    return send(res, 204);
  }
  if (req.method !== "POST" || url.pathname !== "/v1/messages") return send(res, 404, { error: "not found" });
  if (req.headers["x-api-key"] !== KEY)
    return send(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  if (!req.headers["anthropic-version"])
    return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "anthropic-version" } });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "json" } });
  }
  if (body.tools !== undefined || body.output_config?.format?.type !== "json_schema")
    return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "tools or schema" } });
  if (spent)
    return send(res, 400, {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    });
  const user = typeof body.messages?.[0]?.content === "string" ? body.messages[0].content : "";
  return send(res, 200, {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text: JSON.stringify(answerFor(user)) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}).listen(PORT, () => console.log(`Fake Claude API on http://localhost:${PORT}`));
