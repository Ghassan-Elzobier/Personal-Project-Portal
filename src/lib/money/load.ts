import "server-only";
import { parseMoney, type MoneyState } from "./state";
import { MoneyStoreError, readMoney } from "./store";

/** The Money state, or a message saying why it could not be read. */
export async function loadMoney(): Promise<
  { state: MoneyState; error?: undefined } | { state?: undefined; error: string }
> {
  try {
    return { state: parseMoney(await readMoney()) };
  } catch (e) {
    return { error: e instanceof MoneyStoreError ? e.message : "Money could not be read. Try again in a minute." };
  }
}
