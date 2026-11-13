// Life blocks: lunch, cooking, cleaning, gym and the like. They live in Google
// Calendar, never in Asana, so mentors never see them. Pure, so it is tested.

export const LIFE_KINDS = {
  lunch: { label: "Lunch", googleColor: "6", className: "bg-orange/25 ring-orange/50 text-orange-100" },
  cooking: { label: "Cooking", googleColor: "5", className: "bg-sand/25 ring-sand/50 text-amber-100" },
  cleaning: { label: "Cleaning", googleColor: "7", className: "bg-aqua/20 ring-aqua/50 text-cyan-100" },
  gym: { label: "Gym", googleColor: "10", className: "bg-mint/20 ring-mint/50 text-emerald-100" },
  rest: { label: "Rest", googleColor: "3", className: "bg-fuchsia/20 ring-fuchsia/50 text-pink-100" },
  other: { label: "Other", googleColor: "8", className: "bg-white/10 ring-white/25 text-bright" },
} as const;
export type LifeKind = keyof typeof LIFE_KINDS;

export function isLifeKind(value: unknown): value is LifeKind {
  return typeof value === "string" && value in LIFE_KINDS;
}

export const REPEATS = {
  none: "Just once",
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every week on this day",
} as const;
export type Repeat = keyof typeof REPEATS;

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** The RRULE for a repeat choice. weekday is 0 = Monday ... 6 = Sunday. */
export function recurrence(repeat: Repeat, weekday: number): string[] | undefined {
  switch (repeat) {
    case "daily":
      return ["RRULE:FREQ=DAILY"];
    case "weekdays":
      return ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];
    case "weekly":
      return [`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[weekday]}`];
    default:
      return undefined;
  }
}

export type BlockInput = {
  date: string;
  start: number;
  duration: number;
};

/** Validates a block's date, start (minutes after midnight) and duration. */
export function parseBlock(raw: {
  date: unknown;
  start: unknown;
  duration: unknown;
}): { ok: true; value: BlockInput } | { ok: false; error: string } {
  const date = String(raw.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { ok: false, error: "Pick a day." };
  }
  const start = Number(raw.start);
  const duration = Number(raw.duration);
  if (!Number.isInteger(start) || start < 0 || start >= 24 * 60 || start % 5 !== 0) {
    return { ok: false, error: "Pick a start time." };
  }
  if (!Number.isInteger(duration) || duration < 15 || duration > 12 * 60 || duration % 5 !== 0) {
    return { ok: false, error: "A block runs from 15 minutes to 12 hours." };
  }
  if (start + duration > 24 * 60) return { ok: false, error: "A block has to end by midnight." };
  return { ok: true, value: { date, start, duration } };
}

/** "YYYY-MM-DDTHH:mm:00" wall-clock time, as Google wants alongside a timeZone. */
export function wallClock(date: string, minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${date}T${h}:${m}:00`;
}
