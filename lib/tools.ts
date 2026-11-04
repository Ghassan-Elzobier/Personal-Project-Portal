// The portal's tools and who sees each. The home page and the nav both read
// this list, so adding a tool is one entry here plus its page.

export type Role = "owner" | "mentor";

export type Tool = {
  key: "today" | "schedule" | "log" | "week" | "timeline" | "progress" | "people" | "claude";
  title: string;
  href: string;
  description: string;
  roles: readonly Role[];
};

export const TOOLS: readonly Tool[] = [
  {
    key: "today",
    title: "Today",
    href: "/",
    description: "What is overdue, due today, blocked or in progress.",
    roles: ["owner"],
  },
  {
    key: "schedule",
    title: "Schedule",
    href: "/schedule",
    description: "Plan the week: Asana tasks into time slots, plus lunch, gym and the rest.",
    roles: ["owner"],
  },
  {
    key: "log",
    title: "Log a session",
    href: "/log",
    description: "Hours, stage and evidence on a task, in under a minute.",
    roles: ["owner"],
  },
  {
    key: "week",
    title: "Sunday update",
    href: "/week",
    description: "Drafts each project's status update from the week's sessions.",
    roles: ["owner"],
  },
  {
    key: "timeline",
    title: "Timeline",
    href: "/timeline",
    description: "Dated tasks and milestones across every project, from Asana.",
    roles: ["owner", "mentor"],
  },
  {
    key: "progress",
    title: "Progress",
    href: "/progress",
    description: "Read-only progress for each project, as mentors see it.",
    roles: ["owner", "mentor"],
  },
  {
    key: "people",
    title: "People",
    href: "/people",
    description: "Who can sign in, and which projects each mentor sees.",
    roles: ["owner"],
  },
  {
    key: "claude",
    title: "Claude",
    href: "/claude",
    description: "Plan, schedule and log by asking Claude, from the Claude app.",
    roles: ["owner"],
  },
];

export function toolsFor(role: Role): Tool[] {
  return TOOLS.filter((t) => t.roles.includes(role));
}
