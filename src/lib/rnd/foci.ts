// What the R&D agent researches, and when. The agent (.claude/agents/rnd.md)
// takes one focus a run, a few runs a day (.github/workflows/rnd.yml), so every
// part of the portal and of the factory gets a fresh look every few days. By
// hand, a run can take every focus at once (sweep.ts). Pure, so the rotation and
// the gate are tested; the I/O is in scripts/rnd.mjs.

/** Evidence the brief gathers with a script before the agent starts, at no usage. */
export type Evidence = "health" | "audit" | "outdated";

export type Focus = {
  /** Its name in the workflow's focus input, the issue marker and the brief. */
  id: string;
  /** Short, for issue titles: "Gym: …". */
  name: string;
  /** The question a run on this focus answers. */
  question: string;
  /** Where its recent changes are, as git pathspecs (a test checks they exist). */
  paths: string[];
  /** The pages it reviews first (paths from e2e/env.ts); [] for every page, null when it needs none. */
  pages: string[] | null;
  evidence: Evidence[];
};

// In rotation order: each day mixes what the owner sees with how it is built.
// Every tool in the nav (src/lib/config/tools.ts) is some focus's own page, bar
// the design catalogue: a test holds that, so a new tool arrives with a focus,
// or a place in one, and R&D keeps covering the whole portal.
export const FOCI: Focus[] = [
  {
    id: "design",
    name: "Design",
    question:
      "Which feature looks or works worse than the best of the portal, and what would bring it up to that standard?",
    paths: ["src/app", "src/components", "docs/DESIGN.md"],
    pages: [],
    evidence: [],
  },
  {
    id: "study",
    name: "Study",
    question: "What would make the time the owner spends studying with the portal teach more and stick longer?",
    paths: [
      "src/app/study",
      "src/app/lab",
      "src/app/library",
      "src/app/roadmap",
      "src/app/progress",
      "src/lib/study",
      "src/lib/tutor",
      "src/lib/lab",
      "src/lib/library",
    ],
    pages: ["/study", "/study/learn", "/study/graph", "/lab", "/library", "/roadmap", "/progress"],
    evidence: [],
  },
  {
    id: "security",
    name: "Security",
    question:
      "Where is the weakest defence between the internet and the owner's data, and how should it be strengthened?",
    paths: [
      "src/proxy.ts",
      "src/lib/auth",
      "src/lib/supabase",
      "src/lib/connector",
      "src/app/api",
      "src/app/oauth",
      "src/app/auth",
      "src/app/login",
      "src/app/no-access",
      "src/app/people",
      "supabase/migrations",
      "next.config.ts",
      "vercel.json",
      ".github/workflows",
      "SECURITY.md",
    ],
    // Who can sign in, and what each mentor sees.
    pages: ["/people"],
    evidence: ["audit"],
  },
  {
    id: "navigation",
    name: "Navigation",
    question:
      "How many taps do the things the owner does most take, and does every screen show what matters at that moment?",
    paths: [
      "src/components/nav.tsx",
      "src/components/nav-links.tsx",
      "src/components/quick-add.tsx",
      "src/lib/config/tools.ts",
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/your-day.tsx",
    ],
    pages: [],
    evidence: [],
  },
  {
    id: "gym",
    name: "Gym",
    question: "What would help the owner's training progress faster and more safely, session by session?",
    paths: ["src/app/life/gym", "src/app/life/body", "src/lib/life/gym"],
    pages: ["/life/gym", "/life/body"],
    evidence: [],
  },
  {
    id: "performance",
    name: "Performance",
    question: "What makes pages slower than they need to be on a Pixel 7, without giving up fresh pages?",
    paths: ["src/app", "src/lib/portal", "src/lib/supabase", "supabase/migrations", "next.config.ts"],
    pages: [],
    evidence: [],
  },
  {
    id: "cohesion",
    name: "One portal",
    question: "Where do study, schedule, gym, food and money fail to work together, or do the same job two ways?",
    paths: ["src/lib/portal", "src/app", "src/components"],
    pages: [],
    evidence: [],
  },
  {
    id: "food",
    name: "Food",
    question: "What would make eating for the owner's goals take less effort, within their food rules?",
    paths: [
      "src/app/life/page.tsx",
      "src/app/life/kitchen",
      "src/app/life/recipes",
      "src/app/life/settings",
      "src/lib/life",
    ],
    pages: ["/life", "/life/kitchen", "/life/recipes", "/life/settings"],
    evidence: [],
  },
  {
    id: "code",
    name: "Code",
    question: "What structural weakness will slow the next features down most?",
    paths: ["src", "scripts"],
    pages: null,
    evidence: ["health"],
  },
  {
    id: "schedule",
    name: "Schedule",
    question: "How could the portal plan the owner's days so that the plans survive the week?",
    paths: [
      "src/app/schedule",
      "src/app/week",
      "src/app/tasks",
      "src/app/timeline",
      "src/app/log",
      "src/lib/calendar",
      "src/lib/tasks",
      "src/app/life/todos",
      "src/lib/life/todos",
    ],
    pages: ["/", "/schedule", "/week", "/tasks", "/timeline", "/log", "/life/todos"],
    evidence: [],
  },
  {
    id: "factory",
    name: "Factory",
    question:
      "What should the factory adopt, change or drop, given what has changed in agent-driven development and in this toolchain?",
    paths: [
      ".claude",
      ".github",
      "scripts",
      "src/lib/ci",
      "src/lib/rnd",
      "docs/FACTORY.md",
      "docs/factory",
      "AGENTS.md",
    ],
    pages: null,
    evidence: ["outdated"],
  },
  {
    id: "money",
    name: "Money",
    question: "What would make the budget run itself better and the owner's money decisions easier?",
    paths: ["src/app/life/money", "src/lib/money", "src/app/money-line.tsx"],
    pages: ["/life/money"],
    evidence: [],
  },
  {
    id: "connector",
    name: "Connector",
    question:
      "What should the owner be able to do just by asking Claude, and do the connector's tools let a model do it well?",
    paths: [
      "src/lib/connector",
      "src/lib/life/connector.ts",
      "src/lib/money/connector.ts",
      "src/lib/tutor/connector.ts",
      "src/lib/portal/operations.ts",
      "src/app/api/mcp",
      "src/app/claude",
    ],
    pages: ["/claude"],
    evidence: [],
  },
  {
    id: "jobs",
    name: "Jobs",
    question:
      "What would turn the roles out there into the owner's next step: what to study, what to show and where to apply?",
    paths: ["src/app/jobs", "src/app/job-hunt", "src/lib/jobs"],
    pages: ["/jobs", "/job-hunt"],
    evidence: [],
  },
  {
    id: "reliability",
    name: "Reliability",
    question: "Which failure would the owner meet first that no test, alert or backup would catch?",
    paths: [
      "src/lib/errors",
      "src/app/errors",
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/app/api/errors",
      "scripts/error-triage.mjs",
      "e2e",
      "supabase/tests",
    ],
    pages: ["/errors"],
    evidence: [],
  },
];

/** The cron lines in .github/workflows/rnd.yml, earliest first (UTC); a test holds the two together. */
export const SLOTS = ["23 6 * * *", "23 10 * * *", "23 14 * * *", "23 18 * * *"];

export const DEFAULT_RUNS_PER_DAY = SLOTS.length;
export const DEFAULT_OPEN_LIMIT = 8;

const whole = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = /^\s*\d+\s*$/.test(raw ?? "") ? Number(raw) : fallback;
  return Math.min(max, Math.max(min, n));
};

/** RND_RUNS_PER_DAY: 0 turns the schedule off; more than there are slots means every slot. */
export const runsPerDay = (raw: string | undefined) => whole(raw, DEFAULT_RUNS_PER_DAY, 0, SLOTS.length);

/** RND_OPEN_LIMIT: how many proposals may wait for the owner before R&D pauses itself. */
export const openLimit = (raw: string | undefined) => whole(raw, DEFAULT_OPEN_LIMIT, 1, 30);

/** Whether a slot runs when the owner wants `perDay` runs a day: spread through the day, the first slot first. */
export function slotRuns(slot: number, perDay: number): boolean {
  if (perDay <= 0 || slot < 0 || slot >= SLOTS.length) return false;
  const n = Math.min(perDay, SLOTS.length);
  return Math.floor((slot * n) / SLOTS.length) !== Math.floor(((slot - 1) * n) / SLOTS.length);
}

/** The slot a given UTC hour falls in: the latest one that has started, or the first. */
export function slotAt(hour: number): number {
  const starts = SLOTS.map((cron) => Number(cron.split(" ")[1]));
  return Math.max(
    0,
    starts.findLastIndex((start) => start <= hour),
  );
}

/** The rotation moves on one focus per run, so with n runs a day every focus comes round every 12/n days. */
export function focusFor(day: string, slot: number, perDay: number): Focus {
  const n = Math.min(Math.max(perDay, 1), SLOTS.length);
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const run = dayNumber * n + Math.floor((slot * n) / SLOTS.length);
  return FOCI[((run % FOCI.length) + FOCI.length) % FOCI.length];
}

export type Plan = { run: true; focus: Focus; why: string } | { run: false; why: string };

export type PlanInput = {
  /** github.event_name */
  event: string;
  /** github.event.schedule: the cron line that started a scheduled run */
  schedule: string;
  /** The focus chosen for a run by hand: an id, or "auto" for the rotation. */
  focus: string;
  perDay: string | undefined;
  openLimit: string | undefined;
  /** R&D proposals still open, waiting for the owner. */
  open: number;
  /** Today in UTC (YYYY-MM-DD) and the hour now. */
  day: string;
  hour: number;
};

/** Whether this run goes ahead, and on which focus. Runs by hand always go ahead. */
export function planRun(input: PlanInput): Plan {
  const perDay = runsPerDay(input.perDay);
  if (input.event === "workflow_dispatch") {
    const chosen = FOCI.find((f) => f.id === input.focus);
    const focus = chosen ?? focusFor(input.day, slotAt(input.hour), perDay);
    return { run: true, focus, why: `run by hand on ${chosen ? "the chosen" : "the rotation's"} focus` };
  }
  if (input.event !== "schedule")
    return { run: false, why: `R&D runs on its schedule or by hand, not on "${input.event}"` };
  const slot = SLOTS.indexOf(input.schedule);
  if (slot < 0) return { run: false, why: `"${input.schedule}" is not one of R&D's slots (src/lib/rnd/foci.ts)` };
  if (!slotRuns(slot, perDay)) return { run: false, why: `RND_RUNS_PER_DAY is ${perDay}, which leaves this slot out` };
  const limit = openLimit(input.openLimit);
  if (input.open >= limit)
    return {
      run: false,
      why: `${input.open} proposals are waiting for a decision (RND_OPEN_LIMIT is ${limit}); R&D starts again when fewer are open`,
    };
  return { run: true, focus: focusFor(input.day, slot, perDay), why: `slot ${slot + 1} of ${perDay} today` };
}
