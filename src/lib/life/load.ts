import "server-only";
import { timeZone } from "../config/env";
import { addDays, dateIn } from "../dates/week";
import { buildState, type LifeState } from "./state";
import { LifeError, readLife } from "./store";

/** Today in the portal's time zone. */
export function lifeToday(): string {
  return dateIn(new Date(), timeZone());
}

/** The Life state for today, or a message saying why it could not be read. */
export async function loadLife(): Promise<{ state: LifeState; error?: undefined } | { state?: undefined; error: string }> {
  const today = lifeToday();
  try {
    const raw = await readLife(addDays(today, -28));
    return { state: buildState(raw, today) };
  } catch (e) {
    return { error: e instanceof LifeError ? e.message : "Life could not be read. Try again in a minute." };
  }
}
