import "server-only";
import * as store from "./store";

// Money tools for the Claude connector: setting up the budget from the owner's real
// totals. Each is held by the database to the level the owner set on the Money page
// (off, summary, plan, setup); these two need setup. They never return a single
// payment, an account number or the bank connection, and can't erase anything.

type Json = Record<string, unknown>;
type ToolResult = { text: string; isError?: boolean };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Json, ctx: { base: string }) => Promise<ToolResult>;
};

const ok = (value: unknown): ToolResult => ({ text: JSON.stringify(value, null, 1) });
const err = (message: string): ToolResult => ({ text: message, isError: true });

async function attempt(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof store.MoneyStoreError) return err(e.message);
    throw e;
  }
}

const PENCE = { type: "integer", minimum: 0, maximum: 10_000_000 };
const KIND = {
  type: "string",
  enum: ["income", "bills", "groceries", "essentials", "discretionary", "savings", "transfer"],
};

export const MONEY_TOOLS: Tool[] = [
  {
    name: "get_money_history",
    title: "Money: totals by month, category and merchant",
    description:
      "For setting up the owner's budget. Up to 12 months of the owner's bank payments as totals: money in and out by month and category, the merchants money went to most (name, merchant key, category, monthly average, count), the main money coming in, and the categories (with monthly budgets), rules and settings as they are. Amounts are pence, out is positive here. Never single payments. Needs the owner to have set Claude's access to setup on the Money page.",
    inputSchema: {
      type: "object",
      properties: {
        months: { type: "integer", minimum: 1, maximum: 12, description: "How many months back. Default 6." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (args, { base }) =>
      attempt(async () => {
        const months = typeof args.months === "number" ? args.months : 6;
        return ok({ ...((await store.claudeHistory(months)) as Json), page: `${base}/life/money` });
      }),
  },
  {
    name: "plan_money",
    title: "Money: set budgets, categories, rules and watched merchants",
    description:
      "Changes the owner's budget plan in one go, then sorts their payments again. categories: add one (key, name, kind) or change one (key plus name, kind or budget_pence, a month's budget; null clears it). remove_categories: keys. rules: sort a merchant into a category — field 'merchant' with the merchant key from get_money_history, or field 'description' with words to find — and watch: true to alert the owner whenever it's paid (for spending they chose to stop). remove_rules: rule ids. settings: buffer_pence (money always kept back), buffer_from (YYYY-MM-DD), payday_rule ('last-working-day' or 'day-N'). Amounts are pence. Can't change Claude's own access. Needs setup access. Say what you changed, and agree budgets with the owner first.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              key: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
              name: { type: "string", maxLength: 60 },
              kind: KIND,
              budget_pence: { anyOf: [PENCE, { type: "null" }] },
            },
            required: ["key"],
            additionalProperties: false,
          },
        },
        remove_categories: { type: "array", maxItems: 40, items: { type: "string", pattern: "^[a-z0-9-]{1,40}$" } },
        rules: {
          type: "array",
          maxItems: 60,
          items: {
            type: "object",
            properties: {
              field: { type: "string", enum: ["merchant", "description"] },
              pattern: { type: "string", minLength: 2, maxLength: 80 },
              category: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
              watch: { type: "boolean" },
              min_pence: { type: "integer" },
              max_pence: { type: "integer" },
            },
            required: ["field", "pattern"],
            additionalProperties: false,
          },
        },
        remove_rules: { type: "array", maxItems: 60, items: { type: "integer" } },
        settings: {
          type: "object",
          properties: {
            buffer_pence: PENCE,
            buffer_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            payday_rule: { type: "string", pattern: "^(last-working-day|day-([1-9]|[12][0-9]|3[01]))$" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (args, { base }) =>
      attempt(async () => {
        const changed = await store.claudePlan(args);
        return ok({ changed, page: `${base}/life/money` });
      }),
  },
];

export const MONEY_INSTRUCTIONS =
  "Money is the owner's bank data and budget; the owner sets on the Money page how far Claude may go (off, summary, plan, setup). To set up the budget with the owner, call get_money_history, talk the numbers through, then plan_money with the budgets, rules and watched merchants you agreed. Amounts are pence. Never ask for or repeat account numbers.";
