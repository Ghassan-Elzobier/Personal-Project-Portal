// A made-up Lunch Flow for the end-to-end suite, so no test ever reaches the real
// one: one current account in Lunch Flow's shape, and a balance the tests can set
// (POST /__balance?pence=123456). Playwright starts it beside the app
// (playwright.config.ts), and scripts/e2e-env.sh points the app at it.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_LUNCHFLOW_PORT ?? 3199);
const KEY = process.env.LUNCHFLOW_API_KEY || "e2e-made-up-key";

// A published example IBAN with a made-up holder: nothing real.
const ACCOUNT = {
  id: 9001,
  connection_id: 1,
  name: "000000 Example00001234",
  institution_name: "Example Bank",
  institution_logo: "",
  provider: "gocardless",
  status: "ACTIVE",
  raw: {
    gocardless: {
      iban: "GB33BUKB20201555551234",
      scan: "20201555551234",
      name: "Example Account 1234",
      usage: "PRIV",
      currency: "GBP",
      ownerName: "Example Owner",
      resourceId: "example-resource",
      cashAccountType: "CACC",
    },
  },
};

let pence = 123456;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/__balance") {
    const next = Number(url.searchParams.get("pence"));
    if (!Number.isInteger(next)) return send(res, 400, { error: "pence" });
    pence = next;
    return send(res, 204);
  }
  if (req.headers["x-api-key"] !== KEY) return send(res, 401, { error: "unauthorised" });
  if (req.method === "GET" && url.pathname === "/accounts") return send(res, 200, { accounts: [ACCOUNT], total: 1 });
  if (req.method === "GET" && url.pathname === `/accounts/${ACCOUNT.id}/balance`)
    return send(res, 200, { balance: { amount: pence / 100, currency: "GBP" } });
  return send(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`Fake Lunch Flow on http://localhost:${PORT}`));
