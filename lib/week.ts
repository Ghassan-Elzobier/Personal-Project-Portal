// Date helpers that respect the portal's time zone. Pure, so they are tested
// with node's test runner (lib/week.test.ts).

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date at this instant in the time zone, as YYYY-MM-DD. */
export function dateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant midnight starts on this date in the time zone. */
export function midnightIn(date: string, timeZone: string): Date {
  return zonedInstant(date, 0, timeZone);
}

/** The instant a wall-clock time (minutes after midnight) happens on a date in the zone. */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // A second pass settles times where the offset changes in between.
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** The zone's calendar date and minutes after midnight at this instant. */
export function zonedParts(instant: Date, timeZone: string): { date: string; minutes: number } {
  const local = new Date(instant.getTime() + offsetMs(instant, timeZone));
  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** "09:30" from minutes after midnight. */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes after midnight from "09:30", or null. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday, for a YYYY-MM-DD date. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export type Week = {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Sunday, YYYY-MM-DD. */
  end: string;
  /** The instant the week starts in the time zone. */
  startsAt: Date;
  /** The instant the next week starts. */
  endsAt: Date;
};

/** The Monday-to-Sunday week containing this instant. */
export function weekOf(instant: Date, timeZone: string): Week {
  const today = dateIn(instant, timeZone);
  const start = addDays(today, -weekdayIndex(today));
  const end = addDays(start, 6);
  return {
    start,
    end,
    startsAt: midnightIn(start, timeZone),
    endsAt: midnightIn(addDays(start, 7), timeZone),
  };
}

/** "3 Nov" style, for headings. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
