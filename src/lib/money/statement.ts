// A statement downloaded from the bank's internet banking as CSV, turned into rows,
// and the rows the feed already has left out. Pure, so it is tested on made-up files.
//
// The usual layout is a few lines about the account, then a header such as
// "Date","Transaction type","Description","Paid out","Paid in","Balance", with dates
// like "01 Nov 2026" and amounts like "£1,234.56". The header is found by its names,
// so a different order or an extra column still reads. Nothing in the file is kept
// except the rows; the account lines (name, number) are skipped.

import { withFingerprints, type Method } from "./feed.ts";
import { toPence } from "./map.ts";

export type StatementRow = {
  booked_on: string;
  made_on: string;
  pence: number;
  method: Method;
  description: string;
  fingerprint: string;
};

export class StatementError extends Error {}

/** Splits one CSV line, honouring quotes and doubled quotes inside them. */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "01 Nov 2026", "01/11/2026" or "2026-11-01" as "2026-11-01". */
export function statementDate(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    return month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** "£1,234.56" (or "1234.56", or a mangled pound sign) as pence; empty is null. */
function amount(text: string | undefined): number | null {
  const t = (text ?? "").replace(/[^0-9.-]/g, "");
  return t ? Math.abs(toPence(t)) : null;
}

function methodFrom(type: string): Method {
  const t = type.toLowerCase();
  if (/visa|card|contactless|purchase/.test(t)) return "card";
  if (/direct debit/.test(t)) return "direct-debit";
  if (/standing order/.test(t)) return "standing-order";
  if (/cash|atm|withdrawal/.test(t)) return "cash";
  if (/transfer|payment|credit|bank/.test(t)) return "transfer";
  return "other";
}

const find = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h));

/** The statement's rows, oldest first, and the days it covers. */
export function parseStatement(text: string): { rows: StatementRow[]; from: string; to: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const at = lines.findIndex((l) => {
    const h = csvLine(l).map((c) => c.toLowerCase());
    return (
      h.includes("date") && find(h, /description|^transactions?$/) >= 0 && find(h, /paid out|debit|money out/) >= 0
    );
  });
  if (at < 0)
    throw new StatementError(
      "This doesn't look like a bank statement CSV. Download the statement as CSV from internet banking, then try again.",
    );
  const header = csvLine(lines[at]).map((c) => c.toLowerCase());
  const col = {
    date: header.indexOf("date"),
    type: find(header, /type/),
    text: find(header, /description|^transactions?$/),
    out: find(header, /paid out|debit|money out/),
    in: find(header, /paid in|credit|money in/),
  };
  const rows: Omit<StatementRow, "fingerprint">[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    const cells = csvLine(line);
    const on = statementDate(cells[col.date] ?? "");
    if (!on) continue;
    const out = amount(cells[col.out]);
    const inn = col.in >= 0 ? amount(cells[col.in]) : null;
    const pence = out ? -out : (inn ?? 0);
    if (!pence) continue;
    const type = col.type >= 0 ? (cells[col.type] ?? "") : "";
    const description = (cells[col.text] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || type || "Payment";
    rows.push({ booked_on: on, made_on: on, pence, method: methodFrom(type), description });
  }
  if (!rows.length) throw new StatementError("That statement has no payments in it.");
  rows.sort((a, b) => a.booked_on.localeCompare(b.booked_on));
  return { rows: withFingerprints(rows), from: rows[0].booked_on, to: rows[rows.length - 1].booked_on };
}

/**
 * The rows to add: each statement row is matched to one row already held for the same
 * day and amount (from the feed or an earlier statement), and only unmatched ones are new.
 */
export function newStatementRows<T extends { booked_on: string; pence: number }>(
  rows: T[],
  held: { booked_on: string | null; pence: number }[],
): { add: T[]; skipped: number } {
  const left = new Map<string, number>();
  for (const h of held)
    if (h.booked_on) left.set(`${h.booked_on}|${h.pence}`, (left.get(`${h.booked_on}|${h.pence}`) ?? 0) + 1);
  const add: T[] = [];
  for (const r of rows) {
    const key = `${r.booked_on}|${r.pence}`;
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    else add.push(r);
  }
  return { add, skipped: rows.length - add.length };
}
