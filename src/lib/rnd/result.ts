// What an R&D run hands back, checked before anything is published. The agent
// answers in this shape (claude --json-schema, given by scripts/rnd.mjs plan),
// and the filer (scripts/rnd.mjs file) checks it again here, because what it
// files is a public GitHub issue: nothing malformed, no secrets, nothing personal.

export const OUTCOMES = ["proposal", "update", "nothing", "private"] as const;
export const SERVES = ["study", "schedule", "gym", "food", "money", "whole portal", "factory"] as const;
export const SIZES = ["small", "medium", "large"] as const;
/** Where a withheld security weakness is: all that the public run log ever says about it. */
export const AREAS = [
  "sign-in",
  "database access",
  "server actions",
  "routes",
  "connector",
  "secrets",
  "dependencies",
  "workflows",
  "other",
] as const;

export type Serves = (typeof SERVES)[number];
export type Size = (typeof SIZES)[number];
export type Area = (typeof AREAS)[number];

export type Proposal = {
  title: string;
  serves: Serves;
  problem: string;
  evidence: { where: string; what: string }[];
  research: { source: string; url: string; finding: string }[];
  change: string;
  acceptance: string[];
  considered: string;
  risks: string;
  size: Size;
  impact: number;
  confidence: number;
};

export type Result =
  | { outcome: "proposal"; lookedAt: string; proposal: Proposal }
  | { outcome: "update"; lookedAt: string; issue: number; proposal: Proposal }
  | { outcome: "nothing"; lookedAt: string }
  // Nothing else is kept from a private answer, so nothing else can be printed by mistake.
  | { outcome: "private"; area: Area };

const LIMITS = {
  looked_at: 500,
  title: 90,
  problem: 1500,
  where: 200,
  what: 400,
  source: 200,
  url: 500,
  finding: 500,
  change: 2500,
  acceptance: 300,
  considered: 1200,
  risks: 800,
};
const COUNTS = { evidence: [1, 8], research: [1, 6], acceptance: [1, 3] } as const;

const text = (field: keyof typeof LIMITS, description: string) => ({
  type: "string",
  minLength: 1,
  maxLength: LIMITS[field],
  description,
});
const record = (properties: Record<string, object>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const list = (items: object, [minItems, maxItems]: readonly [number, number], description: string) => ({
  type: "array",
  minItems,
  maxItems,
  items,
  description,
});

/** The answer's JSON Schema, for `claude --json-schema`. Its text has no single quotes: the workflow quotes it with them. */
export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "looked_at"],
  properties: {
    outcome: {
      type: "string",
      enum: OUTCOMES,
      description:
        "proposal: one new idea. update: new evidence for the open R&D issue named in issue. nothing: no idea cleared the bar. private: a security weakness that must not be made public.",
    },
    looked_at: text(
      "looked_at",
      "What this run examined, in one or two sentences. It is printed in the public run log, so for private say only the area.",
    ),
    issue: { type: "integer", minimum: 1, description: "For update only: the number of the open R&D issue." },
    area: { type: "string", enum: AREAS, description: "For private only: where the weakness is, and nothing more." },
    proposal: {
      ...record({
        title: text("title", "What changes for the owner, in a few plain words, without the focus name."),
        serves: { type: "string", enum: SERVES, description: "The outcome it improves most." },
        problem: text("problem", "What is wrong or missing today, from the owner side of the screen. Markdown."),
        evidence: list(
          record({
            where: text(
              "where",
              "A repository path with an optional :line or :start-end, a page such as /life/gym, or an issue such as #12.",
            ),
            what: text("what", "What it shows."),
          }),
          COUNTS.evidence,
          "Checkable facts from this repository and its pages.",
        ),
        research: list(
          record({
            source: text("source", "Author or publisher, title and year."),
            url: text("url", "An https link to the source itself, which you read."),
            finding: text("finding", "What it says that matters here, in your own words."),
          }),
          COUNTS.research,
          "The sources behind the change.",
        ),
        change: text(
          "change",
          "The smallest change that delivers most of the value: what the owner will see and do differently, then how it fits the code. Markdown.",
        ),
        acceptance: list(text("acceptance", "One check a test can make."), COUNTS.acceptance, "Done when."),
        considered: text("considered", "The other candidates you weighed, and why this one won."),
        risks: text("risks", "What could go wrong or cost the owner, and how the change avoids it."),
        size: { type: "string", enum: SIZES },
        impact: { type: "integer", minimum: 1, maximum: 5 },
        confidence: { type: "integer", minimum: 1, maximum: 5 },
      }),
      description: "For proposal and update: the idea, written for the owner reading on a phone.",
    },
  },
} as const;

export type Checked = { ok: true; result: Result; trimmed: string[] } | { ok: false; problems: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(values: readonly T[], v: unknown): v is T => values.includes(v as T);

/** A safe, normalised result, or the problems with it. Problems name fields only, never their text. */
export function checkResult(raw: unknown): Checked {
  const problems: string[] = [];
  const trimmed: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ["the answer is not an object"] };

  const str = (v: unknown, field: string, limit: keyof typeof LIMITS): string => {
    if (typeof v !== "string" || !v.trim()) {
      problems.push(`${field} is missing`);
      return "";
    }
    const s = v.trim();
    if (s.length <= LIMITS[limit]) return s;
    trimmed.push(field);
    return s.slice(0, LIMITS[limit] - 1).trimEnd() + "…";
  };
  const items = (v: unknown, field: keyof typeof COUNTS): unknown[] => {
    const [min, max] = COUNTS[field];
    if (!Array.isArray(v) || v.length < min) {
      problems.push(`${field} needs at least ${min}`);
      return [];
    }
    if (v.length > max) trimmed.push(field);
    return v.slice(0, max);
  };
  const score = (v: unknown, field: string): number => {
    if (typeof v !== "number" || !Number.isInteger(v)) problems.push(`${field} is not a whole number`);
    return Math.min(5, Math.max(1, Math.round(Number(v) || 1)));
  };
  const pick = <T extends string>(values: readonly T[], v: unknown, field: string): T => {
    if (oneOf(values, v)) return v;
    problems.push(`${field} is not one of: ${values.join(", ")}`);
    return values[0];
  };

  if (!oneOf(OUTCOMES, raw.outcome)) return { ok: false, problems: ["outcome is not one of the four"] };
  if (raw.outcome === "private") {
    return oneOf(AREAS, raw.area)
      ? { ok: true, result: { outcome: "private", area: raw.area }, trimmed }
      : { ok: false, problems: ["area is missing for a private finding"] };
  }
  const lookedAt = str(raw.looked_at, "looked_at", "looked_at");
  if (raw.outcome === "nothing") {
    return problems.length ? { ok: false, problems } : { ok: true, result: { outcome: "nothing", lookedAt }, trimmed };
  }

  const p = raw.proposal;
  if (!isRecord(p)) return { ok: false, problems: [`proposal is missing for ${raw.outcome}`] };
  const proposal: Proposal = {
    title: str(p.title, "title", "title").replace(/\s+/g, " "),
    serves: pick(SERVES, p.serves, "serves"),
    problem: str(p.problem, "problem", "problem"),
    evidence: items(p.evidence, "evidence").map((e, i) => {
      const r = isRecord(e) ? e : {};
      return {
        where: str(r.where, `evidence ${i + 1} where`, "where"),
        what: str(r.what, `evidence ${i + 1} what`, "what"),
      };
    }),
    research: items(p.research, "research").map((e, i) => {
      const r = isRecord(e) ? e : {};
      const url = str(r.url, `research ${i + 1} url`, "url");
      if (url && !safeUrl(url)) problems.push(`research ${i + 1} url is not a plain https link`);
      return {
        source: str(r.source, `research ${i + 1} source`, "source"),
        url,
        finding: str(r.finding, `research ${i + 1} finding`, "finding"),
      };
    }),
    change: str(p.change, "change", "change"),
    acceptance: items(p.acceptance, "acceptance").map((a, i) => str(a, `acceptance ${i + 1}`, "acceptance")),
    considered: str(p.considered, "considered", "considered"),
    risks: str(p.risks, "risks", "risks"),
    size: pick(SIZES, p.size, "size"),
    impact: score(p.impact, "impact"),
    confidence: score(p.confidence, "confidence"),
  };

  if (raw.outcome === "update") {
    const issue = raw.issue;
    if (typeof issue !== "number" || !Number.isInteger(issue) || issue < 1)
      problems.push("issue is missing for update");
    if (problems.length) return { ok: false, problems };
    return { ok: true, result: { outcome: "update", lookedAt, issue: issue as number, proposal }, trimmed };
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, result: { outcome: "proposal", lookedAt, proposal }, trimmed };
}

/** An https link to a public host, with no credentials in it. */
export function safeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const SECRETS: [string, RegExp][] = [
  ["an Anthropic key or token", /\bsk-ant-[\w-]{8,}/],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/],
  ["a Supabase key", /\b(?:sbp_[0-9a-f]{20,}|sb_secret_[\w-]{8,})/],
  ["a JSON web token", /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a cloud key", /\b(?:AKIA[0-9A-Z]{16}|AIza[\w-]{35})\b/],
  ["a chat token", /\bxox[abprs]-[\w-]{10,}/],
];
// The top-level domain is letters, so "next@16.4.6" is a package, not an address.
const EMAIL = /[\w.+-]+@((?:[\w-]+\.)+[A-Za-z]{2,})\b/g;
const MADE_UP = /^(?:example\.(?:test|com|org|net)|users\.noreply\.github\.com)$/i;
const PHONE = /(?:\+44\s?(?:\(0\)\s?)?7\d{3}|\b07\d{3})[\s-]?\d{3}[\s-]?\d{3}\b/;
const SORT_CODE = /\b\d{2}-\d{2}-\d{2}\b/;
const IBAN = /\bGB\d{2}\s?[A-Z]{4}(?:\s?\d){14}\b/;
const DIGIT_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** Luhn's checksum, which every card number passes and most other long numbers fail. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** What in a text looks secret or personal, as kinds ("an email address"), never the values. */
export function findSensitive(text: string, { link = false } = {}): string[] {
  const found = SECRETS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
  if ([...text.matchAll(EMAIL)].some((m) => !MADE_UP.test(m[1]) && !/^git@github\.com$/i.test(m[0])))
    found.push("an email address");
  // Links carry long ids and dates of their own, so only prose is checked for these.
  if (!link) {
    if (PHONE.test(text)) found.push("a phone number");
    if (SORT_CODE.test(text) || IBAN.test(text)) found.push("bank details");
    if ([...text.matchAll(DIGIT_RUN)].some((m) => luhn(m[0].replace(/\D/g, "")))) found.push("a card number");
  }
  return found;
}

/** Every kind of secret or personal detail anywhere in a result; empty when it is safe to publish. */
export function sensitiveIn(result: Result): string[] {
  if (result.outcome === "private") return [];
  const prose: string[] = [result.lookedAt];
  const links: string[] = [];
  if (result.outcome !== "nothing") {
    const p = result.proposal;
    prose.push(p.title, p.problem, p.change, p.considered, p.risks, ...p.acceptance);
    for (const e of p.evidence) prose.push(e.where, e.what);
    for (const r of p.research) {
      prose.push(r.source, r.finding);
      links.push(r.url);
    }
  }
  const kinds = [...prose.flatMap((t) => findSensitive(t)), ...links.flatMap((t) => findSensitive(t, { link: true }))];
  return [...new Set(kinds)];
}
