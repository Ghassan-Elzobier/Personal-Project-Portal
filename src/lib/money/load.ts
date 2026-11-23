import "server-only";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { addDays, dateIn } from "../dates/week";
import { budgetView, mondayOf, monthStart, parseBudget, type BudgetData, type BudgetView } from "./budget";
import { checkIn, type CheckIn } from "./checkin";
import { forecast, type Forecast } from "./forecast";
import { prompts, type Prompt } from "./prompts";
import { parseMoney, parseTransactions, type MoneyState, type Txn } from "./state";
import { MoneyStoreError, readBudget, readMoney, readTransactions } from "./store";

/** How far back the Money page lists transactions. */
const LIST_DAYS = 60;

export type MoneyPage = {
  state: MoneyState;
  txns: Txn[];
  budget: BudgetData;
  view: BudgetView;
  forecast: Forecast | null;
  today: string;
};

/** The Money state with recent transactions and the budget, or a message saying why it could not be read. */
export async function loadMoney(): Promise<(MoneyPage & { error?: undefined }) | { error: string }> {
  try {
    const today = dateIn(now(), timeZone());
    const [money, txns, budget] = await Promise.all([
      readMoney(),
      readTransactions(addDays(today, -LIST_DAYS)),
      readBudget(monthStart(today), mondayOf(today)),
    ]);
    const data = parseBudget(budget);
    return {
      state: parseMoney(money),
      txns: parseTransactions(txns),
      budget: data,
      view: budgetView(data, today),
      forecast: forecast(data, today),
      today,
    };
  } catch (e) {
    return { error: e instanceof MoneyStoreError ? e.message : "Money could not be read. Try again in a minute." };
  }
}

/**
 * What Today shows of Money: the week's numbers, the Monday check-in, and up to two
 * prompts, only for what needs the owner (prompts.ts). Null when Money isn't set up or can't be read.
 */
export async function loadToday(): Promise<{
  data: BudgetData;
  view: BudgetView;
  prompts: Prompt[];
  /** The Monday check-in on last week, Monday to Wednesday until the owner taps it. */
  checkIn: CheckIn | null;
  today: string;
} | null> {
  try {
    const today = dateIn(now(), timeZone());
    const [budget, money] = await Promise.all([readBudget(monthStart(today), mondayOf(today)), readMoney()]);
    const data = parseBudget(budget);
    const view = budgetView(data, today);
    return {
      data,
      view,
      prompts: prompts(data, view, forecast(data, today), parseMoney(money).alerts, today),
      checkIn: checkIn(data, view, today),
      today,
    };
  } catch {
    return null;
  }
}
