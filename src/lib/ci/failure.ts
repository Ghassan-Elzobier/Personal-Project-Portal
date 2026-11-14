// Reading a failed CI run, so a pull request that fails a check gets looked at
// without the owner doing it: infrastructure flakes are rerun, real failures
// are summarised on the pull request and, on the owner's own branches, handed
// to Claude to fix (.github/workflows/ci-triage.yml). Pure, so it is tested
// against the logs that really failed; the I/O is in scripts/ci-triage.mjs.

export type FailureKind = "infrastructure" | "e2e" | "database" | "types" | "lint" | "format" | "guard" | "unknown";

export type Failure = { kind: FailureKind; reason: string; excerpt: string };

/** In every comment the triage's fix job leaves, so attempts can be counted. */
export const FIX_MARKER = "<!-- ci-triage-fix -->";

export const MAX_FIX_ATTEMPTS = 2;

// Transient trouble on the runner or a service, not in the change. Real failures
// are checked first, so one of these words beside a test failure does not hide it.
const INFRASTRUCTURE: [RegExp, string][] = [
  [
    /failed to bind host port[^\n]*address already in use|address already in use/i,
    "a port was already in use on the runner",
  ],
  [/failed to start docker container|failed to start containers/i, "Docker could not start a container on the runner"],
  [/toomanyrequests|rate limit/i, "a registry rate limit"],
  [
    /TLS handshake timeout|i\/o timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|Connection timed out when requesting/i,
    "a network timeout",
  ],
  [/no space left on device/i, "the runner ran out of disk"],
  [/error connecting to api\.github\.com/i, "GitHub's API was unreachable"],
];

const REAL: [FailureKind, RegExp][] = [
  ["guard", /^Guard: \d+ problem\(s\) against/m],
  ["types", /error TS\d+:/],
  ["e2e", /✘|\d+\) \[[\w-]+\] ›|Error: expect\(/],
  ["database", /^not ok \d+/m],
  ["format", /Code style issues found|\[warn\] .*\n.*Code style issues/],
  ["lint", /^\s*\d+:\d+\s+error\s+/m],
];

const MATTERS =
  /✘|\) \[[\w-]+\] ›|Error:|Expected|Received|error TS|^not ok|\berror\b|\[warn\]|Guard:|failed to|address already|timed out|ECONN|rate limit/i;

/** What failed, why, and the few lines that show it. */
export function classifyFailure(log: string): Failure {
  const lines = log.split("\n");
  const excerpt = lines
    .filter((l) => MATTERS.test(l))
    .slice(0, 25)
    .join("\n")
    .slice(0, 3000);
  if (!log.trim()) return { kind: "unknown", reason: "the run's log is not available", excerpt: "" };
  for (const [kind, re] of REAL) {
    if (re.test(log)) return { kind, reason: `a ${kind} check failed`, excerpt };
  }
  for (const [re, reason] of INFRASTRUCTURE) {
    if (re.test(log)) return { kind: "infrastructure", reason, excerpt };
  }
  return { kind: "unknown", reason: "no known pattern matched", excerpt };
}

/** How many times the triage has already tried to fix this pull request. */
export function fixAttempts(commentBodies: string[]): number {
  return commentBodies.filter((body) => body.includes(FIX_MARKER)).length;
}

/**
 * Whether to hand a failure to Claude: only the owner's own `claude/` branches
 * (never a fork), only real failures a code change can fix (the guard needs the
 * owner), a couple of tries at most, and never when the owner said not to.
 */
export function shouldAttemptFix(input: {
  branch: string;
  sameRepo: boolean;
  kind: FailureKind;
  attempts: number;
  labels: string[];
  /** The lines that show the failure; without any there is nothing for Claude to work from. */
  excerpt: string;
}): boolean {
  if (!input.excerpt) return false;
  if (!input.sameRepo || !input.branch.startsWith("claude/")) return false;
  if (input.labels.includes("no-autofix")) return false;
  if (input.attempts >= MAX_FIX_ATTEMPTS) return false;
  return ["e2e", "database", "types", "lint", "format", "unknown"].includes(input.kind);
}
