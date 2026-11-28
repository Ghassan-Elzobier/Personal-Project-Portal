import assert from "node:assert/strict";
import test from "node:test";
import type { Requirement } from "./extract.ts";
import { biggestGapOf, buildStandings, marketRows, roleFit, skillUnlocks, type RoleInput } from "./match.ts";

// Which one skill would bring the most roles closer: the same rule as roleFit, asked "what if".

const need = (skill: string): Requirement => ({ skill, level: "required", quote: `Needs ${skill}`, group: 0 });
const required = (...skills: string[]) => skills.map((s, i) => ({ ...need(s), group: i }));

const standings = buildStandings(new Map(), [
  { gid: "1", skill: "cpp", level: 3, note: "C++ work", url: null },
  { gid: "2", skill: "python", level: 2, note: "Python work", url: null },
]);

const role = (gid: string, requirements: Requirement[], interest: number | null = null): RoleInput => ({
  gid,
  title: `Role ${gid}`,
  company: "Example Ltd",
  family: "graphics",
  seniority: "any",
  location_tier: "london",
  requirements,
  details: {},
  closed_at: null,
  interest,
  stage: "new",
});

// Three roles whose only gap is diffusion, and four that need SLAM and two more gaps besides.
const oneGap = ["1", "2", "3"].map((gid) => role(gid, required("cpp", "python", "diffusion")));
const stretch = ["4", "5", "6", "7"].map((gid) => role(gid, required("cpp", "slam", "houdini", "robotics")));
const roles = [...oneGap, ...stretch];

test("the setup is three One gap roles and four Stretch roles", () => {
  assert.deepEqual(
    roles.map((r) => roleFit(r.requirements, standings).band),
    ["one_gap", "one_gap", "one_gap", "stretch", "stretch", "stretch", "stretch"],
  );
});

test("a skill unlocks the roles it alone would move up a band", () => {
  const unlocks = skillUnlocks(roles, standings);
  assert.equal(unlocks.get("diffusion"), 3);
  assert.equal(unlocks.get("slam"), 0, "the stretch roles still have two other gaps");
  assert.equal(unlocks.has("cpp"), false, "a skill you can show unlocks nothing");
});

test("the market ranks the skill that brings roles closer above the one asked for more", () => {
  const rows = marketRows(roles, standings);
  const gaps = rows.filter((r) => r.standing.status === "missing" || r.standing.status === "near");
  const diffusion = gaps.find((r) => r.skill.key === "diffusion")!;
  const slam = gaps.find((r) => r.skill.key === "slam")!;
  assert.equal(diffusion.unlocks, 3);
  assert.ok(slam.priority > diffusion.priority, "SLAM is asked for more");
  assert.ok(gaps.indexOf(diffusion) < gaps.indexOf(slam), "but diffusion moves roles up");
  assert.equal(gaps[0].skill.key, "diffusion");
});

test("the biggest gap is the one with the most unlocks", () => {
  assert.equal(biggestGapOf(marketRows(roles, standings))?.skill.key, "diffusion");
});

test("when no single skill moves a role up, the biggest gap is still the most asked for", () => {
  const rows = marketRows(
    [
      role("1", required("cpp", "slam", "houdini", "robotics"), 3),
      role("2", required("python", "slam", "diffusion", "nerf")),
    ],
    standings,
  );
  assert.ok(rows.every((r) => r.unlocks === 0));
  assert.equal(biggestGapOf(rows)?.skill.key, "slam");
});

test("with no gaps, there is no biggest gap", () => {
  assert.equal(biggestGapOf(marketRows([role("1", required("cpp", "python"))], standings)), null);
});
