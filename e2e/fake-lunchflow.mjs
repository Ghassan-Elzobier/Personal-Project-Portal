// A made-up Lunch Flow for the end-to-end suite, so no test ever reaches the real
// one: one current account in Lunch Flow's shape, a balance and transactions the tests
// can set (POST /__balance?pence=123456, POST /__transactions with a JSON list of
// {id, date, pence, text, pending}). Playwright starts it beside the app
// (playwright.config.ts), and scripts/e2e-env.sh points the app at it. Like the real
// API, it sends pending transactions only when asked (include_pending=true).
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
let transactions = [];

/** A transaction in Lunch Flow's shape, with the raw bank record it adds. */
const shape = (t) => ({
  id: t.id,
  accountId: ACCOUNT.id,
  amount: t.pence / 100,
  currency: "GBP",
  date: t.date,
  merchant: t.text,
  description: t.text,
  isPending: Boolean(t.pending),
  raw: {
    gocardless: {
      transactionId: t.id,
      bookingDate: t.pending ? undefined : t.date,
      valueDate: t.date,
      transactionAmount: { amount: (t.pence / 100).toFixed(2), currency: "GBP" },
      remittanceInformationUnstructured: t.text,
      proprietaryBankTransactionCode: "PaymentType: VP",
    },
  },
});

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

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method === "POST" && url.pathname === "/__balance") {
    const next = Number(url.searchParams.get("pence"));
    if (!Number.isInteger(next)) return send(res, 400, { error: "pence" });
    pence = next;
    return send(res, 204);
  }
  if (req.method === "POST" && url.pathname === "/__transactions") {
    try {
      const list = JSON.parse(await readBody(req));
      if (!Array.isArray(list)) return send(res, 400, { error: "list" });
      transactions = list;
      return send(res, 204);
    } catch {
      return send(res, 400, { error: "json" });
    }
  }
  if (req.headers["x-api-key"] !== KEY) return send(res, 401, { error: "unauthorised" });
  if (req.method === "GET" && url.pathname === "/accounts") return send(res, 200, { accounts: [ACCOUNT], total: 1 });
  if (req.method === "GET" && url.pathname === `/accounts/${ACCOUNT.id}/balance`)
    return send(res, 200, { balance: { amount: pence / 100, currency: "GBP" } });
  if (req.method === "GET" && url.pathname === `/accounts/${ACCOUNT.id}/transactions`) {
    const from = url.searchParams.get("from") ?? "0000-00-00";
    const pending = url.searchParams.get("include_pending") === "true";
    const list = transactions.filter((t) => t.date >= from && (pending || !t.pending)).map(shape);
    return send(res, 200, { transactions: list, total: list.length });
  }
  return send(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`Fake Lunch Flow on http://localhost:${PORT}`));
