// The portal's tools and who sees each. The nav reads this list, so adding a
// tool is one entry here plus its page.

export type Role = "owner" | "mentor";

export type Tool = {
  key: "today" | "study" | "jobs" | "roadmap" | "job-hunt" | "tasks" | "schedule" | "log" | "week" | "timeline" | "progress" | "people" | "claude";
  title: string;
  href: string;
  description: string;
  roles: readonly Role[];
  /** Primary tools stay in view. The rest sit under More. */
  group: "primary" | "more";
  /** Shown to a mentor only when the owner shares this with them. */
  share?: string;
  /** The read-only version of an owner page, labelled so the owner can tell them apart. */
  mentorView?: boolean;
};

export const TOOLS: readonly Tool[] = [
  { key: "today", title: "Today", href: "/", description: "What to do now, what is planned and what needs you.", roles: ["owner"], group: "primary" },
  { key: "study", title: "Study", href: "/study", description: "Work through each book and the renderer, with exercises, reviews and results.", roles: ["owner"], group: "primary" },
  { key: "jobs", title: "Jobs", href: "/jobs", description: "The roles out there, what they ask for, and how your study and projects match.", roles: ["owner"], group: "primary" },
  { key: "tasks", title: "Tasks", href: "/tasks", description: "Every project at a glance, with list and board views and the full task.", roles: ["owner"], group: "primary" },
  { key: "schedule", title: "Schedule", href: "/schedule", description: "Plan the week: tasks into time slots, plus lunch, gym and the rest.", roles: ["owner"], group: "primary" },
  { key: "log", title: "Log a session", href: "/log", description: "Hours, stage and evidence on a task, in under a minute.", roles: ["owner"], group: "more" },
  { key: "week", title: "Sunday update", href: "/week", description: "Drafts each project's status update from the week's sessions.", roles: ["owner"], group: "more" },
  { key: "roadmap", title: "Roadmap", href: "/roadmap", description: "The study roadmap: phases, progress, pace and recall.", roles: ["owner", "mentor"], group: "more", mentorView: true },
  { key: "job-hunt", title: "Job hunt", href: "/job-hunt", description: "Fields, closest roles, the skills gap and applications.", roles: ["owner", "mentor"], group: "more", share: "job-hunt", mentorView: true },
  { key: "timeline", title: "Timeline", href: "/timeline", description: "Dated tasks and milestones across every project.", roles: ["owner", "mentor"], group: "more" },
  { key: "progress", title: "Progress", href: "/progress", description: "Read-only progress for each project, as mentors see it.", roles: ["owner", "mentor"], group: "more" },
  { key: "people", title: "People", href: "/people", description: "Who can sign in, and which projects each mentor sees.", roles: ["owner"], group: "more" },
  { key: "claude", title: "Claude", href: "/claude", description: "Plan, schedule and log by asking Claude, from the Claude app.", roles: ["owner"], group: "more" },
];

export function toolsFor(role: Role): Tool[] {
  return TOOLS.filter((t) => t.roles.includes(role));
}
