// The Asana projects the portal knows about. Keys match the
// `portal.project_key` enum in the database, which decides who may read what.
// Gids come from environment variables so the repo holds no workspace data.

export const PROJECT_KEYS = ["pmpp", "axler", "rendering", "weekly-log"] as const;
export type ProjectKey = (typeof PROJECT_KEYS)[number];

export type ProjectDef = {
  key: ProjectKey;
  title: string;
  /** One line for mentors on what the project tracks. */
  blurb: string;
  envVar: string;
  /** Area of study, for grouping on the home page. */
  area: "GPU programming" | "Linear algebra" | "Weekly";
};

export const PROJECTS: readonly ProjectDef[] = [
  {
    key: "pmpp",
    title: "PMPP 5e",
    blurb: "Programming Massively Parallel Processors, 5th edition, chapter by chapter.",
    envVar: "ASANA_PROJECT_PMPP",
    area: "GPU programming",
  },
  {
    key: "axler",
    title: "Axler LADR",
    blurb: "Linear Algebra Done Right, chapter by chapter.",
    envVar: "ASANA_PROJECT_AXLER",
    area: "Linear algebra",
  },
  {
    key: "rendering",
    title: "Rendering lab",
    blurb: "BVH traversal, neural rendering, Gaussian Splatting and the ray tracer.",
    envVar: "ASANA_PROJECT_RENDERING",
    area: "GPU programming",
  },
  {
    key: "weekly-log",
    title: "Weekly log",
    blurb: "One reflection per week across everything.",
    envVar: "ASANA_PROJECT_WEEKLY_LOG",
    area: "Weekly",
  },
];

export function isProjectKey(value: string): value is ProjectKey {
  return (PROJECT_KEYS as readonly string[]).includes(value);
}

export function projectDef(key: ProjectKey): ProjectDef {
  const def = PROJECTS.find((p) => p.key === key);
  if (!def) throw new Error(`Unknown project ${key}`);
  return def;
}
