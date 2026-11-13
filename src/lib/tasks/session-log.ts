// How a logged session is written to a task, and read back for the weekly
// status draft. Pure, so it is tested with node's test runner.

export const STAGES = ["Not started", "In progress", "Blocked", "Needs review", "Done"] as const;

export const STATUS_TYPES = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
} as const;
export type StatusType = keyof typeof STATUS_TYPES;

const MARKER = "Session log";
const MARKER_RE = /^Session log · (\d+(?:\.\d+)?) h\b/;

export type SessionInput = {
  hours: number;
  stage?: string | null;
  evidence?: string | null;
  notes?: string | null;
};

/** Validates raw form values. Returns an error message, or the clean input. */
export function parseSessionForm(raw: {
  hours: unknown;
  stage?: unknown;
  evidence?: unknown;
  notes?: unknown;
}): { ok: true; value: SessionInput } | { ok: false; error: string } {
  const hours = Number(String(raw.hours ?? "").trim());
  if (!Number.isFinite(hours) || hours <= 0 || hours > 16) {
    return { ok: false, error: "Hours must be a number above 0 and at most 16." };
  }
  if (Math.round(hours * 4) !== hours * 4) {
    return { ok: false, error: "Log hours in quarters, such as 0.25, 1.5 or 2." };
  }

  const stage = typeof raw.stage === "string" && raw.stage.trim() ? raw.stage.trim() : null;
  if (stage && !(STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: `Unknown stage "${stage}".` };
  }

  const evidence = typeof raw.evidence === "string" && raw.evidence.trim() ? raw.evidence.trim() : null;
  if (evidence) {
    let url: URL;
    try {
      url = new URL(evidence);
    } catch {
      return { ok: false, error: "Evidence must be a full link starting with https://." };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: "Evidence must be a web link." };
    }
    if (evidence.length > 1000) return { ok: false, error: "That evidence link is too long." };
  }

  const notes = typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.replace(/\r\n?/g, "\n").trim() : null;
  if (notes && notes.length > 4000) return { ok: false, error: "Notes must be under 4000 characters." };

  return { ok: true, value: { hours, stage, evidence, notes } };
}

/** The comment posted on the task. Its first line is what the drafter reads. */
export function sessionComment(input: SessionInput): string {
  const lines = [`${MARKER} · ${formatHours(input.hours)} h`];
  if (input.stage) lines.push(`Stage: ${input.stage}`);
  if (input.evidence) lines.push(`Evidence: ${input.evidence}`);
  if (input.notes) lines.push("", input.notes);
  return lines.join("\n");
}

/** Hours from a session comment, or null for any other comment. */
export function sessionHours(text: string | null | undefined): number | null {
  const match = text ? MARKER_RE.exec(text) : null;
  return match ? Number(match[1]) : null;
}

export function addHours(current: number | null | undefined, extra: number): number {
  return Math.round(((current ?? 0) + extra) * 100) / 100;
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

export type DraftInput = {
  status: StatusType;
  done: { name: string; hours: number; evidence?: string | null }[];
  next: string[];
  blocked: string[];
  hours: number;
  target: number | null;
};

/** The Sunday status update, in the shape from the design doc. */
export function statusDraft(input: DraftInput & { practice?: string | null }): string {
  const done = input.done.length
    ? input.done
        .map((t) => {
          const parts = [t.name];
          if (t.hours > 0) parts.push(`(${formatHours(t.hours)} h)`);
          if (t.evidence) parts.push(t.evidence);
          return parts.join(" ");
        })
        .join("; ")
    : "Nothing finished this week.";
  const next = input.next.length ? input.next.join("; ") : "To be planned.";
  const blocked = input.blocked.length ? input.blocked.join("; ") : "None";
  const hours = input.target
    ? `${formatHours(input.hours)} of ${formatHours(input.target)} planned`
    : formatHours(input.hours);

  return [
    `Status: ${STATUS_TYPES[input.status]}`,
    `Done this week: ${done}`,
    ...(input.practice ? [`Practice this week: ${input.practice}`] : []),
    `Next week: ${next}`,
    `Blocked / questions for you: ${blocked}`,
    `Hours this week: ${hours}`,
  ].join("\n");
}
