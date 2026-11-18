import "server-only";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { dateIn } from "../dates/week";
import { afford, budgetView, mondayOf, monthStart, parseBudget } from "./budget";
import { nextDue } from "./recurring";
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

/** The budget as the Money page works it out, for Claude: amounts in pence. */
async function summary() {
  const today = dateIn(now(), timeZone());
  const data = parseBudget(await store.readBudget(monthStart(today), mondayOf(today)));
  const view = budgetView(data, today);
  return {
    today,
    balance_pence: view.balance,
    payday: view.payday,
    days_to_payday: view.daysToPayday,
    safe_to_spend_pence: view.safe,
    per_week_to_payday_pence: view.perWeek,
    on_track: view.onTrack,
    this_week: {
      allowance_pence: view.week.allowance,
      spent_pence: view.week.spent,
      over_last_week_pence: view.week.carry,
      planned_pence: view.week.spread,
      left_pence: view.week.left,
    },
    still_to_pay_before_payday: view.stillToPay.map((c) => ({ item: c.key, name: c.name, pence: c.pence, next: c.on })),
    bills: (data.bills ?? [])
      .filter((b) => b.status === "active")
      .map((b) => ({
        id: b.id,
        name: b.name ?? undefined,
        category: b.category,
        cadence: b.cadence,
        expected_pence: b.expectedPence,
        variable: b.variable,
        next_due: nextDue(b, today),
        last_paid_on: b.lastPaidOn,
      })),
    buffer_pence: view.buffer,
    planned_before_payday_pence: view.plannedBefore,
    month_by_category: data.categories
      .filter((c) => c.paidMonth > 0 || (c.budgetPence ?? 0) > 0)
      .map((c) => ({ category: c.key, kind: c.kind, budget_pence: c.budgetPence, out_this_month_pence: c.paidMonth })),
  };
}

export const MONEY_TOOLS: Tool[] = [
  {
    name: "money_afford",
    title: "Money: can I afford it?",
    description:
      "What a purchase would do to the owner's budget, before they buy it. Give its cost in pence (the owner's price, or a typical one you say is a guess), and optionally what it saves a week (a bike repair that replaces the bus). Returns a verdict — fits (this week's amount covers it, or what's safe before payday does without going under the weekly amount), tight (only by spreading it or having less a week), out (it would take them past what's safe before payday, into the buffer or bills) — with the reason, the ways to pay ranked with their effect, and weeks to pay itself back. Writes nothing. If they pick a way, save it with money_plan_purchase. Needs summary access.",
    inputSchema: {
      type: "object",
      properties: {
        pence: { type: "integer", minimum: 1, maximum: 10_000_000 },
        saves_per_week_pence: { type: "integer", minimum: 0, maximum: 1_000_000 },
      },
      required: ["pence"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (args, { base }) =>
      attempt(async () => {
        const today = dateIn(now(), timeZone());
        const data = parseBudget(await store.readBudget(monthStart(today), mondayOf(today)));
        const saves = typeof args.saves_per_week_pence === "number" ? args.saves_per_week_pence : 0;
        return ok({ ...afford(data, today, Number(args.pence), saves), page: `${base}/life/money` });
      }),
  },
  {
    name: "money_plan_purchase",
    title: "Money: save a planned purchase",
    description:
      "Saves a purchase the owner has chosen how to pay for in this chat, so the weekly amount and safe-to-spend count it from now on: name, pence, due_on (YYYY-MM-DD, when they'll pay), funding ('allowance' from that week's amount, 'spread' over weeks 2-12, or 'safe' from what's safe to spend before payday). With id, changes one you added; with id and cancel: true, cancels one you added. When the payment arrives it is matched and stops counting. Only ever after the owner agrees. Needs plan access.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        cancel: { type: "boolean" },
        name: { type: "string", minLength: 1, maxLength: 60 },
        pence: { type: "integer", minimum: 1, maximum: 10_000_000 },
        due_on: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        funding: { type: "string", enum: ["allowance", "spread", "safe"] },
        weeks: { type: "integer", minimum: 1, maximum: 12 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (args, { base }) =>
      attempt(async () => ok({ ...(await store.claudePlanPurchase(args)), page: `${base}/life/money` })),
  },
  {
    name: "get_money_summary",
    title: "Money: this week, safe-to-spend and the month",
    description:
      "How the owner's money stands now: the balance, the next payday, safe-to-spend (balance less fixed costs still to pay before payday, planned purchases and the buffer), what that allows a week until payday against the weekly amount they planned (on_track), this week's amount left (Monday to Sunday), this month by category against budget, and the regular bills Money found by itself with their next day (named only at setup). Amounts are pence. Totals only. Needs Claude's access at summary or above.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (_args, { base }) => attempt(async () => ok({ ...(await summary()), page: `${base}/life/money` })),
  },
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
      "Changes the owner's budget plan in one go, then sorts their payments again. categories: add one (key, name, kind) or change one (key plus name, kind or budget_pence, a month's budget; null clears it). remove_categories: keys. rules: sort a merchant into a category — field 'merchant' with the merchant key from get_money_history, or field 'description' with words to find — and watch: true to alert the owner whenever it's paid (for spending they chose to stop). remove_rules: rule ids. settings: buffer_pence (money always kept back), buffer_from (YYYY-MM-DD), payday_rule ('last-working-day' or 'day-N'), first_payday (YYYY-MM-DD: no payday before it), allowance_pence (the amount to live on each week; null works it out from the flexible budgets). Fixed costs are categories of kind bills or savings; groceries, essentials and discretionary come out of the weekly amount. Amounts are pence. Can't change Claude's own access. Needs setup access. Say what you changed, and agree budgets with the owner first.",
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
        bills: {
          type: "array",
          maxItems: 100,
          description:
            "Bills Money found by itself (ids from get_money_summary): name one, sort it into a category, or set status 'ignored' when it isn't a bill ('active' takes it back).",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string", minLength: 1, maxLength: 60 },
              category: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
              status: { type: "string", enum: ["active", "ignored"] },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        settings: {
          type: "object",
          properties: {
            buffer_pence: PENCE,
            buffer_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            payday_rule: { type: "string", pattern: "^(last-working-day|day-([1-9]|[12][0-9]|3[01]))$" },
            first_payday: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            allowance_pence: { anyOf: [{ type: "integer", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (args, { base }) =>
      attempt(async () => {
        const { bills, ...plan } = args;
        const changed = Object.keys(plan).length ? await store.claudePlan(plan) : undefined;
        const billsChanged = Array.isArray(bills) ? await store.claudeBills(bills as Json[]) : undefined;
        return ok({ changed, bills_changed: billsChanged, page: `${base}/life/money` });
      }),
  },
];

export const MONEY_INSTRUCTIONS =
  "Money is the owner's bank data and budget; the owner sets on the Money page how far Claude may go (off, summary, plan, setup). For how they're doing, call get_money_summary: it leads with this week's amount left, then what that allows a week until payday. When they ask whether they can afford something, get a price (say if it is a guess), call money_afford, explain the verdict plainly with its ways to pay, and if they pick one, save it with money_plan_purchase; if it is out of reach, say so and suggest waiting for payday or a cheaper way. Money finds regular bills by itself after each sync (listed in get_money_summary with their next day); they count on their own days before payday, so don't budget them again. To set up the budget with the owner, call get_money_history, talk the numbers through, then plan_money with the budgets, rules, watched merchants and settings (weekly amount, buffer, first payday) you agreed. Amounts are pence. Never ask for or repeat account numbers.";
