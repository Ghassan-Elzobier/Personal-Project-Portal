import "server-only";
import { timeZone } from "../config/env";
import { addDays, dateIn, zonedParts } from "../dates/week";
import { buildState, type LifeState } from "./state";
import { LifeError, readLife } from "./store";
import { now } from "@/lib/dates/clock";

/** Today in the portal's time zone. */
export function lifeToday(): string {
  return dateIn(now(), timeZone());
}

/** Minutes after midnight in the portal's time zone, while it is still `today` (0 once it isn't). */
export function lifeMinutes(today: string): number {
  const at = zonedParts(now(), timeZone());
  return at.date === today ? at.minutes : 0;
}

/** The Life state for today, or a message saying why it could not be read. */
export async function loadLife(): Promise<
  { state: LifeState; error?: undefined } | { state?: undefined; error: string }
> {
  const today = lifeToday();
  try {
    const raw = await readLife(addDays(today, -28));
    return { state: buildState(raw, today) };
  } catch (e) {
    return { error: e instanceof LifeError ? e.message : "Life could not be read. Try again in a minute." };
  }
}
