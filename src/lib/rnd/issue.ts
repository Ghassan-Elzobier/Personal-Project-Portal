// An R&D proposal as the owner reads it: a GitHub issue, on their phone, with
// the evidence linked to the code at the commit the agent read. Pure; the
// GitHub calls are in scripts/rnd.mjs file.

import { BUILD_MARKER } from "./build.ts";
import type { Focus } from "./foci.ts";
import type { Proposal, Serves } from "./result.ts";

export const LABEL = "rnd";

/** Hidden in every R&D issue, so later runs can tell which focus filed it. */
export const marker = (focus: string) => `<!-- rnd:${focus} -->`;
export const focusOf = (body: string) => /<!-- rnd:([a-z-]+) -->/.exec(body)?.[1] ?? null;

export type Context = {
  /** owner/name */
  repo: string;
  /** The commit the agent read, so evidence links keep pointing at what it saw. */
  sha: string;
  day: string;
  runUrl: string;
  /** Whether a repository path is a file in that commit. */
  isFile: (path: string) => boolean;
  /** This proposal is built straight away (build.ts), so the issue says so and carries the build's marker. */
  building?: boolean;
};

const SERVES: Record<Serves, string> = {
  study: "Studies",
  schedule: "Scheduling",
  gym: "Gym routine",
  food: "Food intake",
  money: "Budgeting",
  "whole portal": "The whole portal",
  factory: "The factory",
};

const THREAD = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull|discussions)\/\d+[^\s)]*/g;

/**
 * Text as GitHub will show it, minus what would reach anyone else: an @-mention
 * notifies its account (and an at-claude could start a Claude run), and a link or
 * reference to another repository's issue appears on that issue. Code stays as it is.
 */
export function quiet(text: string, repo: string): string {
  const other = (r: string) => r.toLowerCase() !== repo.toLowerCase();
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(
              /\[([^\]\n]*)\]\((https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull|discussions)\/[^\s)]+)\)/g,
              (m, label, url, r) => (other(r) ? `${label} (\`${url}\`)` : m),
            )
            .replace(THREAD, (url, r, offset, whole) => (other(r) && whole[offset - 1] !== "`" ? `\`${url}\`` : url))
            .replace(/(?<![\w/`.-])([\w.-]+\/[\w.-]+)#(\d+)\b/g, (m, r) => (other(r) ? `\`${m}\`` : m))
            .replace(/(^|[^\w`])@(?=\w)/g, "$1＠"),
    )
    .join("");
}

export const issueTitle = (focus: Focus, p: Proposal) => `${focus.name}: ${p.title}`.replace(/\s+/g, " ").trim();

/** How an issue and a comment name the run that wrote them: the focus, then a link to the run. */
const byFocus = (focus: Focus) => `R&D's ${focus.name.toLowerCase()} focus`;
const runLink = (runUrl: string) => `[run](${runUrl})`;

/**
 * Whether a text (an issue's body, or a comment) is what this run wrote for this
 * focus. Running the filing job again, after one focus of several failed, must
 * not say anything twice.
 */
export const fromRun = (text: string, focus: Focus, runUrl: string) =>
  text.includes(byFocus(focus)) && text.includes(runLink(runUrl));

const WHERE = /^([\w@+.[\]-]+(?:\/[\w@+.[\]-]+)*)(?::(\d+)(?:-(\d+))?)?$/;

/** A path in the repository becomes a link to those lines at the commit; anything else is shown as written. */
export function whereLink(where: string, ctx: Context): string {
  const m = WHERE.exec(where.trim());
  const path = m?.[1] ?? "";
  if (m && !path.split("/").some((s) => s === "." || s === "..") && ctx.isFile(path)) {
    const lines = m[2] ? `#L${m[2]}${m[3] ? `-L${m[3]}` : ""}` : "";
    const url = `https://github.com/${ctx.repo}/blob/${ctx.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return `[\`${where.trim()}\`](${url}${lines})`;
  }
  if (/^#\d+$/.test(where.trim())) return where.trim();
  return `\`${where.trim().replaceAll("`", "'")}\``;
}

function sourceLink(r: Proposal["research"][number], repo: string): string {
  const label = quiet(r.source, repo).replace(/[[\]]/g, "");
  const thread = new RegExp(THREAD.source).exec(r.url);
  if (thread && thread[1].toLowerCase() !== repo.toLowerCase()) return `${label} (\`${r.url}\`)`;
  return `[${label}](${r.url.replaceAll("(", "%28").replaceAll(")", "%29")})`;
}

const sections = (p: Proposal, ctx: Context, changeHeading: string) => {
  const q = (t: string) => quiet(t, ctx.repo);
  return [
    "## Evidence",
    "",
    ...p.evidence.map((e) => `- ${whereLink(e.where, ctx)}: ${q(e.what)}`),
    "",
    "## What the research says",
    "",
    ...p.research.map((r) => `- ${sourceLink(r, ctx.repo)}: ${q(r.finding)}`),
    "",
    `## ${changeHeading}`,
    "",
    q(p.change),
    "",
    "## Done when",
    "",
    ...p.acceptance.map((a) => `- [ ] ${q(a)}`),
  ];
};

export function issueBody(focus: Focus, p: Proposal, ctx: Context): string {
  const q = (t: string) => quiet(t, ctx.repo);
  return [
    `**For:** ${SERVES[p.serves]} · **Size:** ${p.size} · **Impact:** ${p.impact}/5 · **Confidence:** ${p.confidence}/5`,
    "",
    "## The problem",
    "",
    q(p.problem),
    "",
    ...sections(p, ctx, "The change"),
    "",
    "## Also considered",
    "",
    q(p.considered),
    "",
    "## Risks",
    "",
    q(p.risks),
    "",
    "---",
    "",
    `From ${byFocus(focus)} on ${ctx.day} (${runLink(ctx.runUrl)}). ` +
      (ctx.building
        ? "**Being built:** Claude starts on it as soon as this run ends and links its pull request here; " +
          "merging that closes this issue. **Decline it:** close it as not planned (and its pull request), " +
          "with your reason if you like; the next run on this focus reads it."
        : "**Build it:** comment here asking Claude to build it, as on any issue. " +
          "**Decline it:** close it as not planned, with your reason if you like; the next run on this focus reads it."),
    "",
    ...(ctx.building ? [BUILD_MARKER] : []),
    marker(focus.id),
  ].join("\n");
}

/** New evidence for a proposal that is still open, so a later run strengthens it instead of filing it twice. */
export function updateComment(focus: Focus, p: Proposal, ctx: Context): string {
  const q = (t: string) => quiet(t, ctx.repo);
  return [
    `**More on this from ${byFocus(focus)}** (${ctx.day}, ${runLink(ctx.runUrl)}): ${q(p.title)}`,
    "",
    q(p.problem),
    "",
    ...sections(p, ctx, "The change, as it stands now"),
  ].join("\n");
}
