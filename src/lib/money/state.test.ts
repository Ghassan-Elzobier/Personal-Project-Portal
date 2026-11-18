import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, bankMessage, feedNote, parseMoney, pounds } from "./state.ts";

// What money_read returns, with made-up values.
const raw = {
  settings: { buffer_pence: 0, buffer_from: null, payday_rule: "last-working-day", claude_access: "setup" },
  connection: {
    provider: "lunchflow",
    status: "active",
    last_data_at: "2026-11-18T10:00:00Z",
    created_at: "2026-11-18T09:00:00Z",
  },
  accounts: [
    {
      id: 1,
      name: "Current account",
      kind: "current",
      last4: "5555",
      currency: "GBP",
      in_safe: true,
      hidden: false,
      balance: { pence: 123456, at: "2026-11-18T10:00:00Z", kind: "available" },
    },
    {
      id: 2,
      name: "Savings account",
      kind: "savings",
      last4: null,
      currency: "GBP",
      in_safe: false,
      hidden: true,
      balance: null,
    },
  ],
  last_sync: {
    trigger: "owner",
    started_at: "2026-11-18T10:00:00Z",
    finished_at: "2026-11-18T10:00:05Z",
    outcome: "ok",
    error_code: null,
  },
  last_ok: "2026-11-18T10:00:05Z",
  failures: 0,
};

test("the state has the accounts in use with their latest balance", () => {
  const s = parseMoney(raw);
  assert.equal(s.connection?.status, "active");
  assert.deepEqual(
    s.accounts.map((a) => [a.name, a.last4, a.balance?.pence]),
    [["Current account", "5555", 123456]],
  );
  assert.equal(s.claudeAccess, "setup");
  assert.equal(parseMoney({}).connection, null, "no bank yet");
});

test("money reads the way you'd say it", () => {
  assert.equal(pounds(318560), "£3,185.60");
  assert.equal(pounds(-4205), "−£42.05");
  assert.equal(pounds(0), "£0.00");
  const now = new Date("2026-11-18T12:00:00Z");
  assert.equal(ago("2026-11-18T11:59:40Z", now), "just now");
  assert.equal(ago("2026-11-18T11:15:00Z", now), "45 min ago");
  assert.equal(ago("2026-11-18T09:30:00Z", now), "2 h ago");
  assert.equal(ago("2026-11-17T11:00:00Z", now), "1 day ago");
});

test("the feed says what needs doing, most urgent first, and nothing when all is well", () => {
  const s = parseMoney(raw);
  assert.equal(feedNote(s), null);
  assert.match(feedNote({ ...s, connection: { ...s.connection!, status: "stale" } })!.text, /3 days/);
  assert.equal(feedNote({ ...s, failures: 3 })!.tone, "error");
  const refused = { ...s, lastSync: { outcome: "failed", errorCode: "HTTP_401", startedAt: "" }, failures: 3 };
  assert.match(feedNote(refused)!.text, /refused the key/, "a refused key beats a run of failures");
  assert.match(feedNote({ ...s, connection: { ...s.connection!, status: "off" } })!.text, /Disconnected/);
});

test("every sync code has words that say what to do, and no code is shown raw", () => {
  for (const code of ["NO_KEY", "HTTP_401", "HTTP_429", "HTTP_404", "HTTP_503", "TIMEOUT", "AMOUNT", "UNEXPECTED"]) {
    const text = bankMessage(code);
    assert.ok(text.endsWith("."), code);
    assert.ok(!text.includes(code) || code === "NO_KEY", `${code} reads as words`);
  }
});
