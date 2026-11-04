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
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // A second pass settles dates where the offset changes near midnight.
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
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
