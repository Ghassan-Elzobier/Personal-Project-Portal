// The portal's tools and who sees each. The nav reads this list, so adding a
// tool is one entry here plus its page.
//
// The portal has two spaces. Work is study, the renderer and the job hunt; Life
// is meals, the kitchen, the gym and the body. Today and Schedule belong to both,
// so the day's plan never splits in two. Mentors only ever see Work.

export type Role = "owner" | "mentor";
export type Space = "work" | "life" | "shared";

export type Tool = {
  key:
    | "today"
    | "study"
    | "lab"
    | "library"
    | "jobs"
    | "roadmap"
    | "job-hunt"
    | "tasks"
    | "schedule"
    | "log"
    | "week"
    | "timeline"
    | "progress"
    | "people"
    | "claude"
    | "meals"
    | "gym"
    | "kitchen"
    | "body"
    | "recipes"
    | "life-settings";
  title: string;
  href: string;
  description: string;
  roles: readonly Role[];
  /** Which space's nav it is in. Shared tools are in both. */
  space: Space;
  /** Primary tools stay in view. The rest sit under More. */
  group: "primary" | "more";
  /** Shown to a mentor only when the owner shares this with them. */
  share?: string;
  /** The read-only version of an owner page, labelled so the owner can tell them apart. */
  mentorView?: boolean;
};

export const TOOLS: readonly Tool[] = [
  { key: "today", title: "Today", href: "/", description: "What to do now: your meals, gym and study, in order.", roles: ["owner"], space: "shared", group: "primary" },
  { key: "schedule", title: "Schedule", href: "/schedule", description: "Plan the week: tasks into time slots, plus cooking, gym and the rest.", roles: ["owner"], space: "shared", group: "primary" },
  { key: "study", title: "Study", href: "/study", description: "Work through each book and the renderer, with exercises, reviews and results.", roles: ["owner"], space: "work", group: "primary" },
  { key: "jobs", title: "Jobs", href: "/jobs", description: "The roles out there, what they ask for, and how your study and projects match.", roles: ["owner"], space: "work", group: "primary" },
  { key: "tasks", title: "Tasks", href: "/tasks", description: "Every project at a glance, with list and board views and the full task.", roles: ["owner"], space: "work", group: "primary" },
  { key: "lab", title: "Lab", href: "/lab", description: "How the renderer works: diagrams of its Vulkan code and shader, tied to PMPP.", roles: ["owner"], space: "work", group: "more" },
  { key: "library", title: "Book", href: "/library", description: "Search and read PMPP, in Vulkan words or CUDA ones.", roles: ["owner"], space: "work", group: "more" },
  { key: "log", title: "Log a session", href: "/log", description: "Hours, stage and evidence on a task, in under a minute.", roles: ["owner"], space: "work", group: "more" },
  { key: "week", title: "Sunday update", href: "/week", description: "Drafts each project's status update from the week's sessions.", roles: ["owner"], space: "work", group: "more" },
  { key: "roadmap", title: "Roadmap", href: "/roadmap", description: "The study roadmap: phases, progress, pace and recall.", roles: ["owner", "mentor"], space: "work", group: "more", mentorView: true },
  { key: "job-hunt", title: "Job hunt", href: "/job-hunt", description: "Fields, closest roles, the skills gap and applications.", roles: ["owner", "mentor"], space: "work", group: "more", share: "job-hunt", mentorView: true },
  { key: "timeline", title: "Timeline", href: "/timeline", description: "Dated tasks and milestones across every project.", roles: ["owner", "mentor"], space: "work", group: "more" },
  { key: "progress", title: "Progress", href: "/progress", description: "Read-only progress for each project, as mentors see it.", roles: ["owner", "mentor"], space: "work", group: "more" },
  { key: "people", title: "People", href: "/people", description: "Who can sign in, and which projects each mentor sees.", roles: ["owner"], space: "work", group: "more" },
  { key: "claude", title: "Claude", href: "/claude", description: "Plan, schedule and log by asking Claude, from the Claude app.", roles: ["owner"], space: "work", group: "more" },
  { key: "meals", title: "Meals", href: "/life", description: "This week's menu, cooking and every meal, sized to your target.", roles: ["owner"], space: "life", group: "primary" },
  { key: "gym", title: "Gym", href: "/life/gym", description: "Today's session with every target filled in, and the bench forecast.", roles: ["owner"], space: "life", group: "primary" },
  { key: "kitchen", title: "Kitchen", href: "/life/kitchen", description: "The Sainsbury's basket, the fridge and freezer, and the cupboard.", roles: ["owner"], space: "life", group: "primary" },
  { key: "body", title: "Body", href: "/life/body", description: "Weigh-ins, the trend, targets that learn, and the week's effort.", roles: ["owner"], space: "life", group: "primary" },
  { key: "recipes", title: "Recipes", href: "/life/recipes", description: "Every recipe, with your food rules applied and your ratings.", roles: ["owner"], space: "life", group: "more" },
  { key: "life-settings", title: "Life settings", href: "/life/settings", description: "Body, goal, food rules, routine and gym.", roles: ["owner"], space: "life", group: "more" },
];

export function toolsFor(role: Role): Tool[] {
  return TOOLS.filter((t) => t.roles.includes(role));
}
