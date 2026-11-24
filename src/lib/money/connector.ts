import "server-only";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { dateIn } from "../dates/week";
import { err, ok, type Json, type Tool, type ToolResult } from "../mcp/tool";
import { allocate } from "./allocate";
import { budgetView, mondayOf, monthStart, savedNow } from "./budget";
import { budgetData, foundBills, goalBillId } from "./ongoing";
import { affordCheck } from "./displaces";
import { prompts } from "./prompts";
import { weekSummary } from "./summary";
import { FORECAST_DAYS, forecast, whatIf } from "./forecast";
import { paydayMoves } from "./moves";
import { nextDue } from "./recurring";
import { LOANS, takeHome, type LoanPlan, type PensionKind } from "./takehome";
import * as store from "./store";

// Money tools for the Claude connector: setting up the budget from the owner's real
// totals. Each is held by the database to the level the owner set on the Money page
// (off, summary, plan, setup); these two need setup. They never return a single
// payment, an account number or the bank connection, and can't erase anything.

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
  const data = budgetData(await store.readBudget(monthStart(today), mondayOf(today)), today);
  const view = budgetView(data, today);
  const plan = allocate(data, view.payday);
  return {
    today,
    autopilot: {
      on: view.week.auto,
      floor_pence: view.week.floor,
      target_pence: view.week.target,
      this_week_amount_pence: view.week.allowance,
    },
    goals: (data.goals ?? [])
      .filter((g) => g.status === "active")
      .map((g) => {
        if (g.regular)
          return {
            id: g.id,
            name: g.name,
            kind: g.kind,
            cost_pence: g.regular.costPence,
            cadence: g.regular.cadence,
            setup_pence: g.regular.setupPence,
            estimated: g.regular.estimated,
            start_on: g.regular.startOn,
            // The day its cost counts from (the owner's start, or the first payday it
            // fits); null when it doesn't fit within a year, or its real bill is found.
            counts_from: (data.bills ?? []).find((b) => b.id === goalBillId(g))?.anchorOn ?? null,
          };
        const s = plan?.shares.find((x) => x.id === g.id);
        return {
          id: g.id,
          name: g.name,
          kind: g.kind,
          [g.kind === "debt" ? "owed_pence" : "saved_pence"]: savedNow(g),
          target_pence: g.targetPence,
          due_on: g.dueOn,
          held: g.held,
          next_payday_pence: s?.pence ?? null,
          behind_pace: s?.slipped ?? null,
          there_by: s?.finish ?? null,
        };
      }),
    next_payday_plan: plan && {
      payday: plan.from,
      pay_pence: plan.pay,
      bills_pence: plan.commitments,
      weekly_pence: plan.weekly,
      short: plan.short,
      left_over_pence: plan.surplus,
    },
    set_aside_in_account_pence: view.held,
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
    bills: foundBills(data.bills)
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

/** The budget read with today's date, for the forecast tools. */
async function budgetNow() {
  const today = dateIn(now(), timeZone());
  return { today, data: budgetData(await store.readBudget(monthStart(today), mondayOf(today)), today) };
}

const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const LOAN = { type: "string", enum: Object.keys(LOANS) };
const PENSION_KIND = { type: "string", enum: ["net-pay", "salary-sacrifice", "relief-at-source"] };

/** Take-home a month from what Claude was given: typed, or worked out from a gross salary. */
function payFrom(a: Json): { pence: number; grossYearPence: number | null } | null {
  if (typeof a.take_home_pence === "number") return { pence: a.take_home_pence, grossYearPence: null };
  if (typeof a.gross_year_pence !== "number") return null;
  const t = takeHome({
    grossYearPence: a.gross_year_pence,
    loans: Array.isArray(a.student_loans) ? (a.student_loans as LoanPlan[]).filter((l) => l in LOANS) : [],
    pensionPercent: typeof a.pension_percent === "number" ? a.pension_percent : 0,
    pensionKind: (a.pension_kind as PensionKind) ?? "net-pay",
  });
  return { pence: t.monthPence, grossYearPence: a.gross_year_pence };
}

const SALARY = {
  take_home_pence: { type: "integer", minimum: 0, maximum: 10_000_000, description: "Take-home a month." },
  gross_year_pence: {
    type: "integer",
    minimum: 0,
    maximum: 100_000_000,
    description: "Or the salary a year: take-home is worked out (2026/27 rates, England, Wales and NI).",
  },
  student_loans: { type: "array", maxItems: 3, items: LOAN },
  pension_percent: { type: "number", minimum: 0, maximum: 20 },
  pension_kind: PENSION_KIND,
};

const FORECAST_TOOLS: Tool[] = [
  {
    name: "money_week",
    title: "Money: the week in short",
    description:
      "The owner's weekly summary, written by Money with no input, for a short weekly money note: last week's spending against its amount, what went to which goal when the week closed, categories well off their usual week (against the median of the 7 weeks before), the next 7 days' bills, pay and planned purchases, the forecast's lowest point, whether each goal keeps its pace, and the (at most two) things Money would raise on Today. Amounts are pence. Totals only. Needs summary access.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (_args, { base }) =>
      attempt(async () => {
        const { today, data } = await budgetNow();
        const view = budgetView(data, today);
        const f = forecast(data, today, FORECAST_DAYS, paydayMoves(data, today));
        return ok({
          today,
          ...weekSummary(data, view, f, today),
          raising: prompts(data, view, f, [], today).map((p) => p.text),
          page: `${base}/life/money`,
        });
      }),
  },
  {
    name: "money_forecast",
    title: "Money: the next 13 weeks",
    description:
      "The owner's balance forecast, day by day for 91 days, from the bills Money found (on their days), each week's amount spent through the week, planned purchases, pay on each payday, and what the plan moves to savers and lenders on each payday (a goal held elsewhere's share, a debt's payment when no bill is found for it, named after the goal). Returns the lowest point and its day, the days under the buffer, each Monday's checkpoint (the balance the week should start with if the plan holds), the paydays with their pay (0 when no pay is planned: suggest setting it with money_set_plan), the balance each week, and the next big moves. Amounts are pence. Totals only. Needs summary access.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: (_args, { base }) =>
      attempt(async () => {
        const { today, data } = await budgetNow();
        const f = forecast(data, today, FORECAST_DAYS, paydayMoves(data, today));
        if (!f) return err("Money has no balance yet: the owner connects the bank on the Money page first.");
        return ok({
          today,
          lowest: f.lowest,
          days_under_buffer: f.underBuffer.length,
          first_day_under_buffer: f.underBuffer[0] ?? null,
          buffer_pence: data.bufferPence,
          buffer_from: data.bufferFrom,
          paydays: f.paydays,
          monday_checkpoints: f.checkpoints,
          balance_each_week: f.points.filter((_, i) => i % 7 === 0),
          next_moves: f.events.slice(0, 15),
          page: `${base}/life/money`,
        });
      }),
  },
  {
    name: "money_what_if",
    title: "Money: what if…?",
    description:
      "How a change would move the owner's forecast, before they make it: a different pay (take-home, or a salary a year worked out after tax — a job offer), spending more or less each week (a cheaper commute: a negative weekly_change_pence), a new regular cost (bills: name, pence, cadence, first day), a bill that stops (ends: a bill's id from get_money_summary and the first day it no longer falls due, as when an upgrade replaces a membership), or one-offs on a day. Returns the lowest point and the balance in 13 weeks, before and after, how much each moves, the change as a month's worth, and the take-home worked out. Writes nothing. Needs summary access.",
    inputSchema: {
      type: "object",
      properties: {
        ...SALARY,
        weekly_change_pence: { type: "integer", minimum: -1_000_000, maximum: 1_000_000 },
        bills: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 60 },
              pence: { type: "integer", minimum: 1, maximum: 10_000_000 },
              cadence: { type: "string", enum: ["weekly", "monthly", "yearly"] },
              first_on: DATE,
            },
            required: ["name", "pence", "cadence", "first_on"],
            additionalProperties: false,
          },
        },
        one_offs: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 60 },
              pence: { type: "integer", minimum: 1, maximum: 10_000_000 },
              on: DATE,
            },
            required: ["name", "pence", "on"],
            additionalProperties: false,
          },
        },
        ends: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: { bill_id: { type: "integer" }, from: DATE },
            required: ["bill_id", "from"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: (args, { base }) =>
      attempt(async () => {
        const { today, data } = await budgetNow();
        const pay = payFrom(args);
        const ends = Array.isArray(args.ends)
          ? (args.ends as Json[]).flatMap((e) => {
              const bill = (data.bills ?? []).find((b) => b.id === Number(e.bill_id));
              return bill ? [{ merchantKey: bill.merchantKey, from: String(e.from) }] : [];
            })
          : undefined;
        const result = whatIf(
          data,
          today,
          {
            payPence: pay?.pence,
            weeklyChangePence: typeof args.weekly_change_pence === "number" ? args.weekly_change_pence : undefined,
            bills: Array.isArray(args.bills)
              ? (args.bills as Json[]).map((b) => ({
                  name: String(b.name),
                  pence: Number(b.pence),
                  cadence: b.cadence as "weekly" | "monthly" | "yearly",
                  on: String(b.first_on),
                }))
              : undefined,
            oneOffs: Array.isArray(args.one_offs)
              ? (args.one_offs as Json[]).map((o) => ({
                  name: String(o.name),
                  pence: Number(o.pence),
                  on: String(o.on),
                }))
              : undefined,
            ends,
          },
          paydayMoves(data, today),
        );
        if (!result) return err("Money has no balance yet: the owner connects the bank on the Money page first.");
        return ok({ ...result, take_home_month_pence: pay?.pence ?? null, page: `${base}/life/money` });
      }),
  },
  {
    name: "money_set_plan",
    title: "Money: set the owner's high-level plan",
    description:
      "Sets the high-level plan Money then runs by itself after every sync (it shares each payday out, sets money aside, fixes each week's amount and checks transfers). income: pay steps — from a payday (from_on), the take-home a month, or a salary a year (with student loans and pension) worked out after tax; a step lasts until a later one. remove_income: from_on days. goals, in the owner's order: kind 'saving' (an emergency fund, a bike: target_pence, optional due_on, held 'elsewhere' for a separate saver or 'account', and optional payment_pence, a fixed amount a month: it then takes that each payday and no more, so what's left stays in the account), 'sinking' (a cost that comes once or each year: target_pence, due_on, repeats_yearly, usually held 'account'), 'debt' (saved_pence is what's owed now, payment_pence a month, apr_bp interest in basis points), or 'recurring', a regular cost to take on (a session twice a month, a gym upgrade): cost_pence each time, cadence (weekly, fortnightly, monthly or yearly), weekday for a weekly or fortnightly cost (0 Monday to 6), setup_pence once at the start (a joining fee), replaces_merchant_key the bill it replaces (from get_money_history, so only the difference counts, and replace_overlap for one more payment of it as notice), start_on (leave it out to start on the first payday it fits), estimated when the price is a guess; get_money_summary then says the payday it fits from, at the plan and at the recent pace, and goals ordered above it are protected; merchant_key links a saver or lender's payments (from get_money_history) so progress follows the bank. Give id to change one; saved_pence only on a new goal. remove_goals: ids (only goals you added). order: every goal id, first first. weekly: floor_pence (the least a week: setting it turns the autopilot on) and target_pence (the most). buffer: pence and from (YYYY-MM-DD). Best practice order: buffer, yearly costs, an emergency fund of about three months of bills and food, high-interest debts, then other goals. Agree everything with the owner first. Needs plan access.",
    inputSchema: {
      type: "object",
      properties: {
        income: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            properties: { from_on: DATE, ...SALARY },
            required: ["from_on"],
            additionalProperties: false,
          },
        },
        remove_income: { type: "array", maxItems: 24, items: DATE },
        goals: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string", minLength: 1, maxLength: 60 },
              kind: { type: "string", enum: ["saving", "sinking", "debt", "recurring"] },
              cost_pence: { type: "integer", minimum: 1, maximum: 10_000_000 },
              cadence: { type: "string", enum: ["weekly", "fortnightly", "monthly", "yearly"] },
              weekday: { type: "integer", minimum: 0, maximum: 6 },
              setup_pence: PENCE,
              replaces_merchant_key: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
              replace_overlap: { type: "boolean" },
              start_on: DATE,
              estimated: { type: "boolean" },
              target_pence: PENCE,
              due_on: DATE,
              repeats_yearly: { type: "boolean" },
              held: { type: "string", enum: ["account", "elsewhere"] },
              saved_pence: PENCE,
              apr_bp: { type: "integer", minimum: 0, maximum: 10_000 },
              payment_pence: PENCE,
              merchant_key: { type: "string", pattern: "^[a-z0-9-]{1,60}$" },
              category: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
              status: { type: "string", enum: ["active", "done", "paused"] },
            },
            additionalProperties: false,
          },
        },
        remove_goals: { type: "array", maxItems: 30, items: { type: "integer" } },
        order: { type: "array", maxItems: 60, items: { type: "integer" } },
        weekly: {
          type: "object",
          properties: { floor_pence: PENCE, target_pence: PENCE },
          additionalProperties: false,
        },
        buffer: { type: "object", properties: { pence: PENCE, from: DATE }, additionalProperties: false },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (args, { base }) =>
      attempt(async () => {
        for (const g of Array.isArray(args.goals) ? (args.goals as Json[]) : [])
          if (g.kind === "recurring" && g.id === undefined && (!g.cost_pence || !g.cadence))
            return err(`The regular cost '${String(g.name)}' needs cost_pence and cadence.`);
        const income: Json[] = [];
        for (const step of Array.isArray(args.income) ? (args.income as Json[]) : []) {
          const pay = payFrom(step);
          if (!pay)
            return err(`The pay step from '${String(step.from_on)}' needs take_home_pence or gross_year_pence.`);
          income.push({ from_on: step.from_on, pence: pay.pence, gross_year_pence: pay.grossYearPence });
        }
        const saved = await store.claudeSetPlan({ ...args, income, remove_income: args.remove_income ?? [] });
        return ok({ ...saved, page: `${base}/life/money` });
      }),
  },
];

export const MONEY_TOOLS: Tool[] = [
  ...FORECAST_TOOLS,
  {
    name: "money_afford",
    title: "Money: can I afford it?",
    description:
      "What a purchase would do to the owner's budget, before they buy it. Give its cost in pence (the owner's price, or a typical one you say is a guess), and optionally what it saves a week (a bike repair that replaces the bus). Returns a verdict — fits (this week's amount covers it, or what's safe before payday does without going under the weekly amount), tight (only by spreading it or having less a week), out (it would take them past what's safe before payday, into the buffer or bills) — with the reason, the ways to pay ranked with their effect, and weeks to pay itself back, plus what it displaces in their terms (days of the weekly amount, and how many weeks later the first goal gets there): say that too. Writes nothing. If they pick a way, save it with money_plan_purchase. Needs summary access.",
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
        const data = budgetData(await store.readBudget(monthStart(today), mondayOf(today)), today);
        const saves = typeof args.saves_per_week_pence === "number" ? args.saves_per_week_pence : 0;
        const pence = Number(args.pence);
        return ok({ ...affordCheck(data, today, pence, saves), page: `${base}/life/money` });
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
  "Money is the owner's bank data and budget; the owner sets on the Money page how far Claude may go (off, summary, plan, setup). For how they're doing, call get_money_summary: it leads with this week's amount left, then what that allows a week until payday. When they ask whether they can afford something, get a price (say if it is a guess), call money_afford, explain the verdict plainly with its ways to pay, and if they pick one, save it with money_plan_purchase; if it is out of reach, say so and suggest waiting for payday or a cheaper way. For a weekly money note, call money_week and keep it short: last week, anything unusual, the week ahead. For what's coming, call money_forecast (the lowest point, Monday checkpoints, paydays); for \"what if…\" questions (a job offer's salary, a cheaper commute, a new regular cost), call money_what_if and say how the lowest point and the balance in 13 weeks move. The owner wants a budget that runs itself from a high-level plan: agree their pay, goals in order (best practice: buffer, yearly costs, an emergency fund, high-interest debts, then the rest) and the least and most to live on a week, and save them with money_set_plan; Money then shares each payday out, sets money aside, fixes each week's amount and checks transfers by itself, and get_money_summary shows how each goal is doing. Money finds regular bills by itself after each sync (listed in get_money_summary with their next day); they count on their own days before payday, so don't budget them again. To set up the budget with the owner, call get_money_history, talk the numbers through, then plan_money with the budgets, rules, watched merchants and settings (weekly amount, buffer, first payday) you agreed. Amounts are pence. Never ask for or repeat account numbers.";
