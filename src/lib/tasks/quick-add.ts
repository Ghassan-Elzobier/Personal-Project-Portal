// Reads a quick-add line such as "Read chapter 5 #axler fri". A project tag may
// sit anywhere. A date only counts at the end, so "Friday review" stays a name.
// Pure, so it is tested with node's test runner.

import type { ProjectKey } from "../config/projects.ts";
import { addDays, weekdayIndex } from "../dates/week.ts";

export type QuickAdd = { name: string; project: ProjectKey | null; dueOn: string | null };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const TAGS: Record<string, ProjectKey> = {
  pmpp: "pmpp",
  gpu: "pmpp",
  cuda: "pmpp",
  axler: "axler",
  ladr: "axler",
  rendering: "rendering",
  render: "rendering",
  weekly: "weekly-log",
  "weekly-log": "weekly-log",
  log: "weekly-log",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The next time a day comes round, never today: "fri" on a Friday means next week. */
function nextWeekday(today: string, index: number): string {
  return addDays(today, (index - weekdayIndex(today) + 7) % 7 || 7);
}

function validDate(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function dayMonth(day: number, month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
  if (!validDate(iso)) return null;
  return iso < today ? `${year + 1}-${pad(month + 1)}-${pad(day)}` : iso;
}

/** How many trailing words make a date, and which date. */
function trailingDate(words: string[], today: string): { used: number; date: string } | null {
  const lower = words.map((w) => w.toLowerCase());
  const last = lower.at(-1);
  if (!last) return null;
  const before = lower.at(-2);

  if (last === "today") return { used: 1, date: today };
  if (last === "tomorrow" || last === "tmr") return { used: 1, date: addDays(today, 1) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(last)) return validDate(last) ? { used: 1, date: last } : null;

  const weekday = WEEKDAYS.indexOf(last.slice(0, 3));
  const isWeekday =
    weekday >= 0 &&
    [
      last.slice(0, 3),
      `${["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][weekday]}`,
    ].includes(last);
  if (isWeekday) {
    if (before === "next") return { used: 2, date: addDays(nextWeekday(today, weekday), 7) };
    return { used: 1, date: nextWeekday(today, weekday) };
  }

  // "20 nov" and "nov 20".
  // A month is its three letters, "sept" or its full name; "decomposition" is not "dec".
  const monthOf = (w: string | undefined) => {
    if (!w || w.length < 3) return -1;
    const month = MONTHS.indexOf(w.slice(0, 3));
    return month >= 0 && (w.length === 3 || w === "sept" || w === MONTH_NAMES[month]) ? month : -1;
  };
  if (before && /^\d{1,2}$/.test(before) && monthOf(last) >= 0) {
    const date = dayMonth(Number(before), monthOf(last), today);
    return date ? { used: 2, date } : null;
  }
  if (before && /^\d{1,2}$/.test(last) && monthOf(before) >= 0) {
    const date = dayMonth(Number(last), monthOf(before), today);
    return date ? { used: 2, date } : null;
  }
  return null;
}

export function parseQuickAdd(text: string, today: string): QuickAdd {
  let project: ProjectKey | null = null;
  const words: string[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const tag = word.startsWith("#") ? TAGS[word.slice(1).toLowerCase()] : undefined;
    if (tag) project = tag;
    else words.push(word);
  }
  const { name, dueOn } = splitDue(words, today);
  return { name, project, dueOn };
}

/**
 * Words and the date they end with, if they end with one: "Renew passport fri" is
 * "Renew passport", due on the next Friday. Tasks and Life's to-dos share it.
 */
export function splitDue(words: readonly string[], today: string): { name: string; dueOn: string | null } {
  const rest = [...words];
  let dueOn: string | null = null;
  // Keep at least one word, so "tomorrow" alone is a task called tomorrow.
  const found = rest.length > 1 ? trailingDate(rest, today) : null;
  if (found && rest.length > found.used) {
    dueOn = found.date;
    rest.splice(rest.length - found.used, found.used);
    if (rest.at(-1)?.toLowerCase() === "due" && rest.length > 1) rest.pop();
  }
  return { name: rest.join(" "), dueOn };
}

/** Names from pasted lines, without list markers. */
export function pastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+/i, "").trim())
    .filter(Boolean);
}
