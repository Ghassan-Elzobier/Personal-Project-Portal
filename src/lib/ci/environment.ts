// What a session can run here. A claude.ai cloud session may lack a Docker
// daemon or be refused a host by its network allowlist, and each session used to
// find that out part-way through. The session hook probes once
// (scripts/cloud-env.mjs) and prints one line from these probe results, so
// Claude plans for what it can't run from the start. Pure, so it is tested here.

/** The hosts the suites need: Supabase's images, Playwright's, the web font, Node. */
export const HOSTS = ["public.ecr.aws", "mcr.microsoft.com", "fonts.gstatic.com", "nodejs.org"] as const;

export type Host = (typeof HOSTS)[number];

export type Probes = {
  /** The docker command is installed. */
  dockerInstalled: boolean;
  /** A Docker daemon answers `docker info`. */
  dockerDaemon: boolean;
  /** Whether each host answered a request within the time limit. */
  hosts: Record<Host, boolean>;
  /** node_modules is installed. */
  installed: boolean;
  /** The running Node's major version, and the one .nvmrc pins. */
  node: number;
  wantNode: number;
};

export type Suite = "check" | "build" | "test:db" | "test:e2e";

export type Verdict = { suite: Suite; able: boolean; missing?: string };

type Need = "installed" | "docker" | Host;

// In the order each suite meets them, so the first missing one is named.
const NEEDS: Record<Suite, Need[]> = {
  check: ["installed"],
  build: ["installed", "fonts.gstatic.com"],
  "test:db": ["docker", "public.ecr.aws"],
  "test:e2e": ["installed", "docker", "public.ecr.aws", "mcr.microsoft.com", "fonts.gstatic.com"],
};

const lacking = (need: Need, probes: Probes): string | undefined => {
  if (need === "installed") return probes.installed ? undefined : "dependencies not installed";
  if (need === "docker") {
    if (!probes.dockerInstalled) return "no Docker";
    return probes.dockerDaemon ? undefined : "no Docker daemon";
  }
  return probes.hosts[need] ? undefined : `${need} refused`;
};

/** What each suite can do here, naming the first thing it is missing. */
export function assess(probes: Probes): Verdict[] {
  return (Object.keys(NEEDS) as Suite[]).map((suite) => {
    for (const need of NEEDS[suite]) {
      const missing = lacking(need, probes);
      if (missing) return { suite, able: false, missing };
    }
    return { suite, able: true };
  });
}

/** One line for the session, e.g. `Here: check ✓ · build ✗ fonts.gstatic.com refused · …`. */
export function summary(probes: Probes): string {
  const parts = assess(probes).map((v) => (v.able ? `${v.suite} ✓` : `${v.suite} ✗ ${v.missing}`));
  if (probes.node !== probes.wantNode) parts.push(`Node ${probes.node}, not ${probes.wantNode}`);
  return `Here: ${parts.join(" · ")}`;
}
