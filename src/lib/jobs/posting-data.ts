// The job details a page publishes for search engines: schema.org's JobPosting, in a
// <script type="application/ld+json"> block. Most job sites carry one so that Google
// lists the role, so reading it fills in a role from its link with rules alone, no
// model needed. Pure, so it is tested.
//
// What a page says is untrusted: every value comes out as plain text, cut to size,
// and nothing read here ever becomes a URL to fetch.

import { isDay } from "../dates/week.ts";
import { advertText } from "./extract.ts";

export type PostingData = {
  title: string;
  company: string;
  location: string;
  salary: string;
  /** YYYY-MM-DD, or "" when the page gives none. */
  postedOn: string;
  closesOn: string;
  /** The advert as plain lines, from the posting's description. */
  text: string;
};

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** One line of plain text from whatever a field holds. */
function line(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return advertText(String(value)).replace(/\s+/g, " ").trim().slice(0, max);
}

const nameOf = (value: unknown, max = 200) => (isNode(value) ? line(value.name, max) : line(value, max));

/** A date as YYYY-MM-DD, from a date or a date-time. */
function dayOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())?.[1] ?? "";
  return isDay(day) ? day : "";
}

function isJobPosting(node: Node): boolean {
  return list(node["@type"]).some((t) => t === "JobPosting" || t === "schema:JobPosting");
}

/** Every node in a JSON-LD document: arrays, @graph and a page's mainEntity. */
function nodesOf(doc: unknown, depth = 0): Node[] {
  if (depth > 3) return [];
  return list(doc).flatMap((item) => {
    if (!isNode(item)) return [];
    return [item, ...nodesOf(item["@graph"], depth + 1), ...nodesOf(item.mainEntity, depth + 1)];
  });
}

function placeOf(place: unknown): string {
  if (!isNode(place)) return line(place, 200);
  const address = place.address;
  if (!isNode(address)) return line(address, 200) || line(place.name, 200);
  const parts = [address.addressLocality, address.addressRegion, nameOf(address.addressCountry)]
    .map((p) => line(p, 100))
    .filter(Boolean);
  return [...new Set(parts)].join(", ");
}

function locationOf(posting: Node): string {
  const places = [...new Set(list(posting.jobLocation).map(placeOf).filter(Boolean))];
  const remote = list(posting.jobLocationType).some((t) => typeof t === "string" && /telecommute/i.test(t));
  if (remote) {
    const where = list(posting.applicantLocationRequirements)
      .map((r) => nameOf(r))
      .filter(Boolean);
    places.push(where.length ? `Remote, ${where.join(", ")}` : "Remote");
  }
  return places.join("; ").slice(0, 500);
}

const UNITS: Record<string, string> = {
  HOUR: "an hour",
  DAY: "a day",
  WEEK: "a week",
  MONTH: "a month",
  YEAR: "a year",
};

function amount(value: unknown, currency: string): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return "";
  const figure = n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return currency === "GBP" ? `£${figure}` : `${currency} ${figure}`.trim();
}

/** "£45,000 to £55,000 a year", in words the salary reader (salary.ts) understands. */
function salaryOf(posting: Node): string {
  const pay = posting.baseSalary ?? posting.estimatedSalary;
  const first = list(pay)[0];
  if (!isNode(first)) return line(first, 200);
  const currency = line(first.currency, 3).toUpperCase();
  const value = first.value;
  const range = isNode(value)
    ? [amount(value.minValue ?? value.value, currency), amount(value.maxValue, currency)]
    : [amount(value, currency), ""];
  const unit = UNITS[(isNode(value) ? line(value.unitText, 10) : line(first.unitText, 10)).toUpperCase()] ?? "";
  const [low, high] = range;
  if (!low) return "";
  return [high && high !== low ? `${low} to ${high}` : low, unit].filter(Boolean).join(" ").slice(0, 200);
}

/** The first JobPosting a page publishes, or null when it has none. */
export function postingData(html: string): PostingData | null {
  // A browser ends a script at "</script" whatever follows it, and a comment at "--!>"
  // as well as "-->", so these match the same (CodeQL js/bad-tag-filter).
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi,
  )) {
    let doc: unknown;
    try {
      doc = JSON.parse(m[1].replace(/^\s*(?:<!--|\/\/\s*<!\[CDATA\[)/, "").replace(/(?:--!?>|\/\/\s*\]\]>)\s*$/, ""));
    } catch {
      continue;
    }
    const posting = nodesOf(doc).find(isJobPosting);
    if (!posting) continue;
    return {
      title: line(posting.title ?? posting.name, 300),
      company: nameOf(posting.hiringOrganization),
      location: locationOf(posting),
      salary: salaryOf(posting),
      postedOn: dayOf(posting.datePosted),
      closesOn: dayOf(posting.validThrough),
      text: typeof posting.description === "string" ? advertText(posting.description) : "",
    };
  }
  return null;
}
