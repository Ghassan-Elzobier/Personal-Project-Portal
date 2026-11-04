// The portal's tools and who sees each. The home page and the nav both read
// this list, so adding a tool is one entry here plus its page.

export type Role = "owner" | "mentor";

export type Tool = {
  key: "today" | "log" | "week" | "progress" | "people";
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
];

export function toolsFor(role: Role): Tool[] {
  return TOOLS.filter((t) => t.roles.includes(role));
}
