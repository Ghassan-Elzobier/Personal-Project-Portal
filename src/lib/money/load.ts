import "server-only";
import { timeZone } from "../config/env";
import { now } from "../dates/clock";
import { addDays, dateIn } from "../dates/week";
import { parseMoney, parseTransactions, type MoneyState, type Txn } from "./state";
import { MoneyStoreError, readMoney, readTransactions } from "./store";

/** How far back the Money page lists transactions. */
const LIST_DAYS = 60;

/** The Money state with recent transactions, or a message saying why it could not be read. */
export async function loadMoney(): Promise<
  { state: MoneyState; txns: Txn[]; error?: undefined } | { state?: undefined; txns?: undefined; error: string }
> {
  try {
    const since = addDays(dateIn(now(), timeZone()), -LIST_DAYS);
    const [money, txns] = await Promise.all([readMoney(), readTransactions(since)]);
    return { state: parseMoney(money), txns: parseTransactions(txns) };
  } catch (e) {
    return { error: e instanceof MoneyStoreError ? e.message : "Money could not be read. Try again in a minute." };
  }
}
