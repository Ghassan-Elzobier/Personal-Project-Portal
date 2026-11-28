#!/usr/bin/env node
// Says which suites this session can run. The cloud branch of the session hook
// (.claude/hooks/session-start.sh) runs it, and Claude reads the line it prints.
// Probes in parallel, each limited to five seconds: `docker info`, and a HEAD
// request through curl (which follows the session's proxy variables) to each
// host in src/lib/ci/environment.ts. Sends no credentials, prints no values from
// the environment, and always exits 0 so it never fails the session.
//
//   node --experimental-strip-types --no-warnings scripts/cloud-env.mjs
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { HOSTS, summary } from "../src/lib/ci/environment.ts";

const LIMIT_MS = 5000;

/** Whether a command exits 0 within the limit. */
const succeeds = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: LIMIT_MS }, (error) => resolve(!error));
  });

try {
  const [dockerInstalled, dockerDaemon, ...reached] = await Promise.all([
    succeeds("sh", ["-c", "command -v docker"]),
    succeeds("docker", ["info"]),
    // Any HTTP answer, even 401 from a registry, means the host is reachable.
    ...HOSTS.map((host) =>
      succeeds("curl", ["-sS", "-o", "/dev/null", "-I", "--max-time", String(LIMIT_MS / 1000), `https://${host}/`]),
    ),
  ]);
  console.log(
    summary({
      dockerInstalled,
      dockerDaemon,
      hosts: Object.fromEntries(HOSTS.map((host, i) => [host, reached[i]])),
      installed: existsSync("node_modules"),
      node: Number(process.versions.node.split(".")[0]),
      wantNode: Number(readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".")[0]),
    }),
  );
} catch (error) {
  console.log(`Here: the environment check could not run (${error instanceof Error ? error.message : "unknown"})`);
}
process.exit(0);
