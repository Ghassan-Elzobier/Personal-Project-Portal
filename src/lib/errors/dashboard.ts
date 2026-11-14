// What the errors page (src/app/errors) shows, shaped from error_list and
// error_detail: the days in a trend, how long ago, the devices an error was seen
// on, and its stack frames with the app's own linked to GitHub. Pure, so it is
// tested; the page reads the clock and passes "now" in.
import { addDays } from "../dates/week.ts";
import { appFrame, deviceLabel, sourceUrl, type ErrorSource } from "./display.ts";

export type DailyCount = { day: string; occurrences: number };

export type ErrorRow = {
  fingerprint: string;
  source: ErrorSource;
  name: string;
  message: string;
  route: string;
  context: string;
  stack: string;
  release: string | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  status: "new" | "filed" | "ignored";
  issue_number: number | null;
  daily: DailyCount[];
};

export type ErrorEventRow = {
  occurred_at: string;
  release: string | null;
  reporter: "owner" | "mentor" | "connector";
  browser: string | null;
  os: string | null;
  device: string;
  viewport: string | null;
  breadcrumbs: { at: string; kind: string; text: string }[];
};

export type ErrorDetail = ErrorRow & { events: ErrorEventRow[] };

/** The count for each of the last `days` days up to `today` (UTC dates), oldest first; zero where nothing happened. */
export function dailySeries(daily: DailyCount[], today: string, days: number): { day: string; count: number }[] {
  const counts = new Map(daily.map((d) => [d.day, d.occurrences]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - days + 1);
    return { day, count: counts.get(day) ?? 0 };
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, as a person says it: "just now", "25 min ago", "3 h ago", "yesterday", "4 days ago", or the date. */
export function ago(iso: string, now: Date): string {
  const gone = now.getTime() - Date.parse(iso);
  if (gone < MINUTE) return "just now";
  if (gone < HOUR) return `${Math.floor(gone / MINUTE)} min ago`;
  if (gone < DAY) return `${Math.floor(gone / HOUR)} h ago`;
  if (gone < 2 * DAY) return "yesterday";
  if (gone < 7 * DAY) return `${Math.floor(gone / DAY)} days ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
}

/** Each device an error was seen on, with how often, the most common first. Screen sizes are left out to group them. */
export function devices(
  events: { browser: string | null; os: string | null; device: string; viewport: string | null }[],
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const label = deviceLabel({ ...event, viewport: null }) ?? "Unknown device";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** The stack's frames, the app's own linked to their line on GitHub when the repository and release are known. */
export function frames(
  stack: string,
  release: string | null,
  repo: string | null,
): { text: string; own: boolean; href: string | null }[] {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => {
      const frame = appFrame(text);
      return { text, own: Boolean(frame), href: frame && release && repo ? sourceUrl(repo, release, frame) : null };
    });
}
