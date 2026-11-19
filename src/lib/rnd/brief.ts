// The parts of an R&D brief that need thought to get right: what R&D proposed
// before and what the owner decided, and the facts about every page. The brief
// is written by a script before the agent starts (scripts/rnd.mjs brief), so the
// agent spends its turns on judgement, not on gathering. Pure, and tested.

import type { Focus } from "./foci.ts";
import { focusOf } from "./issue.ts";

export type PastIssue = {
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  body: string;
  closedAt?: string | null;
  comments: { author?: { login: string } | null; body: string }[];
};

const DECISIONS: Record<string, string> = { COMPLETED: "built", NOT_PLANNED: "declined", DUPLICATE: "a duplicate" };
const oneLine = (text: string, max: number) => {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * Open proposals from every focus, so a run never files one twice, then this
 * focus's decided ones with the owner's own last word on each. Only the owner's
 * comments are kept: anyone can comment on a public repository.
 */
export function historySection(issues: PastIssue[], focusId: string, owner: string, limit = 15): string {
  const open = issues.filter((i) => i.state === "OPEN").sort((a, b) => a.number - b.number);
  const decided = issues
    .filter((i) => i.state !== "OPEN" && focusOf(i.body) === focusId)
    .sort((a, b) => b.number - a.number)
    .slice(0, limit);
  const lines = [
    "## What R&D proposed before",
    "",
    'Open, from every focus. Never file one of these again; with new evidence for one, answer "update" with its number.',
    "",
    ...(open.length ? open.map((i) => `- #${i.number} ${oneLine(i.title, 120)}`) : ["- (none)"]),
    "",
    "Decided, on this focus, newest first. A declined idea comes back only with evidence that answers the reason.",
    "",
  ];
  if (!decided.length) lines.push("- (none yet)");
  for (const i of decided) {
    const decision = DECISIONS[i.stateReason ?? ""] ?? "closed";
    const said = [...i.comments].reverse().find((c) => c.author?.login.toLowerCase() === owner.toLowerCase());
    const day = i.closedAt ? `, ${i.closedAt.slice(0, 10)}` : "";
    const quote = said ? ` The owner wrote: "${oneLine(said.body, 300)}"` : "";
    lines.push(`- #${i.number} ${oneLine(i.title, 120)} (${decision}${day}).${quote}`);
  }
  return lines.join("\n");
}

/** What e2e/page-shots.spec.ts records about each page, beside its screenshot. */
export type PageFacts = {
  path: string;
  shot: string;
  screens: number;
  tapTargets: number;
  under24: number;
  under48: number;
  links: string[];
  headings: string[];
  words: number;
  jsKb: number;
  requests: number;
  lcpMs: number;
  cls: number;
};

/** The fewest taps from one page to each of the others, following the links each page shows. */
export function tapsFrom(start: string, pages: PageFacts[]): Map<string, number> {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const taps = new Map([[start, 0]]);
  const queue = [start];
  for (let here = queue.shift(); here !== undefined; here = queue.shift()) {
    const steps = (taps.get(here) ?? 0) + 1;
    for (const link of byPath.get(here)?.links ?? []) {
      const to = link.split(/[?#]/)[0] || "/";
      if (byPath.has(to) && !taps.has(to)) {
        taps.set(to, steps);
        queue.push(to);
      }
    }
  }
  return taps;
}

/** One row a page, this focus's pages first; the agent opens the screenshots that matter. */
export function pagesSection(pages: PageFacts[], focus: Focus): string {
  const mine = new Set(focus.pages ?? []);
  const taps = tapsFrom("/", pages);
  const rows = [...pages].sort(
    (a, b) => Number(mine.has(b.path)) - Number(mine.has(a.path)) || a.path.localeCompare(b.path),
  );
  return [
    "| Page | Shot | Taps from Today | Screens long | Tap targets (under 24 / 48 px) | Links | Words | JS KB | LCP ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (p) =>
        `| ${p.path}${mine.has(p.path) ? " ★" : ""} | ${p.shot} | ${taps.get(p.path) ?? "–"} | ${p.screens} | ` +
        `${p.tapTargets} (${p.under24} / ${p.under48}) | ${p.links.length} | ${p.words} | ${p.jsKb} | ${p.lcpMs} |`,
    ),
  ].join("\n");
}
