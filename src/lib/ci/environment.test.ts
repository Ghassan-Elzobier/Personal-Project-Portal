import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOSTS, assess, summary, type Probes } from "./environment.ts";

const allReachable = Object.fromEntries(HOSTS.map((host) => [host, true])) as Probes["hosts"];

const everything: Probes = {
  dockerInstalled: true,
  dockerDaemon: true,
  hosts: allReachable,
  installed: true,
  node: 24,
  wantNode: 24,
};

const verdict = (probes: Probes, suite: string) => assess(probes).find((v) => v.suite === suite);

test("with every probe passing, all four suites can run", () => {
  assert.deepEqual(
    assess(everything).map((v) => [v.suite, v.able]),
    [
      ["check", true],
      ["build", true],
      ["test:db", true],
      ["test:e2e", true],
    ],
  );
  assert.equal(summary(everything), "Here: check ✓ · build ✓ · test:db ✓ · test:e2e ✓");
});

test("with no Docker daemon, test:db and test:e2e can't run, and the daemon is named", () => {
  const probes = { ...everything, dockerDaemon: false };
  for (const suite of ["test:db", "test:e2e"])
    assert.deepEqual(verdict(probes, suite), { suite, able: false, missing: "no Docker daemon" });
  assert.equal(verdict(probes, "check")?.able, true);
  assert.equal(verdict(probes, "build")?.able, true);
});

test("with Docker not installed at all, the line says so rather than naming the daemon", () => {
  const probes = { ...everything, dockerInstalled: false, dockerDaemon: false };
  assert.equal(verdict(probes, "test:db")?.missing, "no Docker");
});

test("with fonts.gstatic.com refused, build can't run, and the host is named", () => {
  const probes = { ...everything, hosts: { ...allReachable, "fonts.gstatic.com": false } };
  assert.deepEqual(verdict(probes, "build"), { suite: "build", able: false, missing: "fonts.gstatic.com refused" });
  assert.equal(verdict(probes, "test:e2e")?.missing, "fonts.gstatic.com refused");
  assert.equal(verdict(probes, "test:db")?.able, true);
  assert.equal(
    summary(probes),
    "Here: check ✓ · build ✗ fonts.gstatic.com refused · test:db ✓ · test:e2e ✗ fonts.gstatic.com refused",
  );
});

test("a refused registry names that registry for the suites that pull from it", () => {
  const probes = { ...everything, hosts: { ...allReachable, "mcr.microsoft.com": false } };
  assert.equal(verdict(probes, "test:e2e")?.missing, "mcr.microsoft.com refused");
  assert.equal(verdict(probes, "test:db")?.able, true);
});

test("each suite names the first thing it misses, and a different Node is noted", () => {
  const probes = { ...everything, installed: false, dockerDaemon: false, node: 22 };
  assert.equal(verdict(probes, "test:e2e")?.missing, "dependencies not installed");
  assert.equal(verdict(probes, "test:db")?.missing, "no Docker daemon");
  assert.match(summary(probes), / · Node 22, not 24$/);
});

// The session hook only touches Docker and probes the network in a cloud session.
const hook = readFileSync(new URL("../../../.claude/hooks/session-start.sh", import.meta.url), "utf8").split("\n");

test("the hook starts dockerd and runs cloud-env.mjs only in its CLAUDE_CODE_REMOTE = true block", () => {
  const start = hook.findIndex((line) => line === 'if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then');
  assert.ok(start >= 0, "a block that runs only in a cloud session");
  const end = hook.findIndex((line, i) => i > start && line === "fi");
  assert.ok(end > start, "the cloud block ends");
  const where = (needle: RegExp) => hook.flatMap((line, i) => (needle.test(line) && !/^\s*#/.test(line) ? [i] : []));
  for (const needle of [/\bdockerd\b/, /scripts\/cloud-env\.mjs/]) {
    const lines = where(needle);
    assert.ok(lines.length > 0, `the hook uses ${needle}`);
    for (const i of lines) assert.ok(i > start && i < end, `line ${i + 1} (${needle}) is inside the cloud block`);
  }
});

test("the hook still ends with exit 0, so it never fails a session", () => {
  const lines = hook.filter((line) => line.trim() !== "");
  assert.equal(lines.at(-1), "exit 0");
});
