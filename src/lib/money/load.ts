import "server-only";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { addDays, dateIn } from "../dates/week";
import { budgetView, mondayOf, monthStart, parseBudget, type BudgetData, type BudgetView } from "./budget";
import { parseMoney, parseTransactions, type MoneyState, type Txn } from "./state";
import { MoneyStoreError, readBudget, readMoney, readTransactions } from "./store";

/** How far back the Money page lists transactions. */
const LIST_DAYS = 60;

export type MoneyPage = { state: MoneyState; txns: Txn[]; budget: BudgetData; view: BudgetView; today: string };

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
      today,
    };
  } catch (e) {
    return { error: e instanceof MoneyStoreError ? e.message : "Money could not be read. Try again in a minute." };
  }
}

/** Just the budget, for Today and Claude: null when Money isn't set up or can't be read. */
export async function loadBudget(): Promise<{ data: BudgetData; view: BudgetView; today: string } | null> {
  try {
    const today = dateIn(now(), timeZone());
    const data = parseBudget(await readBudget(monthStart(today), mondayOf(today)));
    return { data, view: budgetView(data, today), today };
  } catch {
    return null;
  }
}
