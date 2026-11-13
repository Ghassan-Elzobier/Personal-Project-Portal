import "server-only";
import { timeZone } from "../config/env";
import { deleteMirror, googleConfigured, googleConnection, putMirror } from "../calendar/google";
import { addDays, zonedParts } from "../dates/week";
import { loadScheduleWeek, resolveWeek, type Mirror } from "../portal/schedule";
import type { AgendaItem } from "./agenda";
import { lifeToday, loadLife } from "./load";
import { now as clockNow } from "@/lib/dates/clock";

// Keeps a copy of the Life plan in Google Calendar for the next two weeks, so the
// phone's calendar shows meals, cooking and the gym where the Schedule does. The
// plan is the source: the copy is rewritten from it after every change (a new
// meal week, a swapped recipe, a study block that pushed lunch along), and an
// item that left the plan leaves the calendar. Only what is still to come is
// touched, so the past stays as it was. Each item has a fixed event id, so two
// syncs at once update one event instead of making two.

const DAYS_AHEAD = 14;
const DEADLINE_MS = 40_000;

export type SyncResult =
  { written: number; removed: number; unchanged: number; partial: boolean } | { skipped: string } | { error: string };

// One at a time per server: a second change while a sync runs waits for it.
let queue: Promise<unknown> = Promise.resolve();

export function syncLifeMirror(): Promise<SyncResult> {
  const next = queue.then(sync, sync);
  queue = next.catch(() => undefined);
  return next;
}

/** For after(): never throws, and says so in the log when it fails. */
export async function syncLifeMirrorQuietly(): Promise<void> {
  try {
    const r = await syncLifeMirror();
    if ("error" in r) console.error("Life calendar sync:", r.error);
  } catch (e) {
    console.error("Life calendar sync:", e);
  }
}

async function sync(): Promise<SyncResult> {
  if (!googleConfigured()) return { skipped: "Google Calendar is not set up for the portal." };
  if (!(await googleConnection())) return { skipped: "Google Calendar is not connected." };

  const began = Date.now();
  const tz = timeZone();
  const today = lifeToday();
  const now = zonedParts(clockNow(), tz).minutes;
  const last = addDays(today, DAYS_AHEAD - 1);
  const life = await loadLife();
  if (life.error !== undefined) return { error: life.error };

  // The Schedule's weeks that cover the next two weeks, arranged as the Schedule shows them.
  const starts = [...new Set([today, addDays(today, 7), last].map((d) => resolveWeek(d).start))];
  const weeks = await Promise.all(starts.map((w) => loadScheduleWeek(resolveWeek(w), { life })));
  const google = weeks[0]?.google;
  if (google && typeof google === "object" && "error" in google) return { error: google.error };

  const ahead = (date: string, start: number) => date >= today && date <= last && (date > today || start > now);
  const wanted = new Map<string, AgendaItem>();
  for (const w of weeks) for (const i of w.life) if (ahead(i.date, i.start)) wanted.set(i.key, i);
  const have = new Map<string, Mirror>();
  for (const w of weeks) for (const m of w.mirrors) have.set(m.id, m);

  let written = 0;
  let removed = 0;
  let unchanged = 0;
  const late = () => Date.now() - began > DEADLINE_MS;

  // Gone from the plan, or moved to another day: remove the copy (only ones still to come).
  const kept = new Set<string>();
  for (const m of have.values()) {
    const i = wanted.get(m.key);
    if (i && i.date === m.date) {
      kept.add(m.key);
      if (i.title === m.title && i.start === m.start && Math.min(24 * 60, i.start + i.duration) === m.end) unchanged++;
      continue;
    }
    if (!ahead(m.date, m.start)) continue;
    if (late()) return { written, removed, unchanged, partial: true };
    await deleteMirror(m.id);
    removed++;
  }

  for (const i of wanted.values()) {
    const m = [...have.values()].find((x) => x.key === i.key);
    const end = Math.min(24 * 60, i.start + i.duration);
    if (m && kept.has(i.key) && m.title === i.title && m.start === i.start && m.end === end) continue;
    if (late()) return { written, removed, unchanged, partial: true };
    await putMirror({
      key: i.key,
      title: i.title,
      date: i.date,
      start: i.start,
      end,
      colour: i.colour,
      note: i.moved ?? i.clash,
    });
    written++;
  }
  return { written, removed, unchanged, partial: false };
}
