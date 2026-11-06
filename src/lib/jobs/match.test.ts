import assert from "node:assert/strict";
import test from "node:test";
import type { Requirement, RequirementLevel } from "./extract.ts";
import { branchImpact, buildStandings, isTarget, isVisible, marketRows, roleFit, unknownTerms, type RoleInput, type StoredEvidence, type UnitFact } from "./match.ts";

const unit = (ref: string, over: Partial<UnitFact> = {}): [string, UnitFact] => [ref, { ref, name: ref, plan: "lab", done: false, solved: 0, measured: false, optional: false, href: `/study?task=${ref}`, dueOn: null, phase: 1, ...over }];
const evidence = (skill: string, level: number): StoredEvidence => ({ gid: skill, skill, level, note: `${skill} work`, url: null });
const need = (skill: string, level: RequirementLevel = "required", group?: number): Requirement => ({ skill, level, quote: `Needs ${skill}`, group: group ?? skill.length * 1000 + skill.charCodeAt(0) });

// Vulkan is taught by r-harness among others, and PyTorch by r-nerf-tiny.
const noUnits = new Map<string, UnitFact>();

test("reading a chapter is studied, and only practice counts as evidence", () => {
  const read = buildStandings(new Map([unit("pmpp-2", { plan: "book", done: true, name: "Ch 2" })]), []);
  assert.equal(read.get("cuda")?.level, 1);
  assert.notEqual(read.get("cuda")?.status, "evidenced");
  const practised = buildStandings(new Map([unit("pmpp-2", { plan: "book", done: true, solved: 3 })]), []);
  assert.equal(practised.get("cuda")?.level, 2);
  assert.equal(practised.get("cuda")?.status, "evidenced");
});

test("a finished milestone is practice, and a recorded result lifts it to measured", () => {
  assert.equal(buildStandings(new Map([unit("r-harness", { done: true })]), []).get("vulkan")?.level, 2);
  assert.equal(buildStandings(new Map([unit("r-harness", { done: true, measured: true })]), []).get("vulkan")?.level, 3);
});

test("evidence you add counts, and the strongest shows first", () => {
  const standing = buildStandings(noUnits, [evidence("python", 2), evidence("python", 4)]).get("python");
  assert.equal(standing?.level, 4);
  assert.equal(standing?.status, "evidenced");
});

test("a unit still to do puts a skill in your plan, with its date", () => {
  const standing = buildStandings(new Map([unit("r-nerf-tiny", { dueOn: "2027-04-01", phase: 7 })]), []).get("pytorch");
  assert.equal(standing?.status, "in_plan");
  assert.equal(standing?.next?.dueOn, "2027-04-01");
});

test("a main-path unit is preferred over an optional one as what comes next", () => {
  const standing = buildStandings(new Map([unit("r-gs-train", { optional: true }), unit("r-nerf-tiny")]), []).get("pytorch");
  assert.equal(standing?.next?.ref, "r-nerf-tiny");
});

test("a related skill makes one close, and never counts as having it", () => {
  const standing = buildStandings(noUnits, [evidence("vulkan", 4)]).get("d3d12");
  assert.equal(standing?.status, "near");
  assert.equal(standing?.nearName, "Vulkan");
  assert.equal(standing?.level, 0);
});

test("a skill nobody teaches and you have not shown is missing", () => {
  assert.equal(buildStandings(noUnits, []).get("diffusion")?.status, "missing");
});

const standings = buildStandings(new Map([unit("r-nerf-tiny", { dueOn: "2027-04-01" }), unit("r-gs-load", { dueOn: "2027-03-01" })]), [evidence("cpp", 4), evidence("python", 2), evidence("vulkan", 4)]);

test("Ready means everything required can be shown", () => {
  assert.equal(roleFit([need("cpp"), need("python"), need("vulkan")], standings).band, "ready");
});

test("one recognised skill is not a match, however well you know it", () => {
  const fit = roleFit([need("python")], standings);
  assert.equal(fit.band, "unread");
  assert.match(fit.reason, /Only Python from your skill list appears/);
  assert.equal(roleFit([need("python"), need("cpp")], standings).band, "unread", "two with nothing else is still thin");
  assert.equal(roleFit([need("python"), need("cpp"), need("slam", "preferred")], standings).band, "ready", "two required and one wanted is enough to judge");
});

test("a wanted skill outside your plan is said, without lowering the band", () => {
  const fit = roleFit([need("cpp"), need("python"), need("slam", "preferred")], standings);
  assert.match(fit.reason, /Also wanted, and not in your plan: SLAM/);
});

test("specialist skills you have or are learning are counted, and general ones are not", () => {
  assert.equal(roleFit([need("cpp"), need("python"), need("vulkan")], standings).specialist, 1, "Vulkan is specialist, and C++ and Python are not");
  assert.equal(roleFit([need("vulkan"), need("pytorch"), need("slam")], standings).specialist, 2, "SLAM is specialist, but you do not have it");
});

test("On your plan means the rest is coming, with the date it all arrives", () => {
  const fit = roleFit([need("cpp"), need("pytorch"), need("gaussian-splatting")], standings);
  assert.equal(fit.band, "by_date");
  assert.equal(fit.readyBy, "2027-04-01");
});

test("one missing must-have is one gap, however much else you can show", () => {
  const fit = roleFit([need("cpp"), need("python"), need("diffusion")], standings);
  assert.equal(fit.band, "one_gap");
  assert.deepEqual(fit.gaps, ["Diffusion models"]);
  assert.match(fit.reason, /Not in your plan: Diffusion models/);
});

test("two missing must-haves are a stretch", () => {
  assert.equal(roleFit([need("diffusion"), need("slam")], standings).band, "stretch");
});

test("gaps in what is only wanted do not lower the band", () => {
  assert.equal(roleFit([need("cpp"), need("python"), need("diffusion", "preferred"), need("slam", "responsibility")], standings).band, "ready");
});

test("alternatives count once, met by the best of them", () => {
  assert.equal(roleFit([need("diffusion", "required", 5), need("cpp", "required", 5), need("python"), need("vulkan")], standings).band, "ready");
  const both = roleFit([need("diffusion", "required", 5), need("slam", "required", 5), need("cpp"), need("python")], standings);
  assert.equal(both.band, "one_gap");
  assert.equal(both.gaps.length, 1);
  assert.deepEqual(both.must[0].orElse, ["SLAM"]);
});

test("nothing recognised is not read, rather than a false ready", () => {
  assert.equal(roleFit([], standings).band, "unread");
  assert.equal(roleFit([need("diffusion", "preferred")], standings).band, "unread");
});

const role = (over: Partial<RoleInput> = {}): RoleInput => ({ gid: "1", title: "Role", company: "Co", family: "graphics", seniority: "any", location_tier: "london", requirements: [], details: {}, closed_at: null, interest: null, stage: "new", ...over });
const fitOf = (...requirements: Requirement[]) => roleFit(requirements, standings);
const strong = fitOf(need("cpp"), need("python"), need("vulkan"));

test("abroad has to be a strong match at a reachable level", () => {
  const abroad = role({ location_tier: "abroad" });
  assert.equal(isVisible(abroad, strong), true);
  assert.equal(isVisible(abroad, fitOf(need("cpp"), need("python"), need("diffusion"))), false);
  assert.equal(isVisible(abroad, fitOf(need("python"))), false, "too little to judge is not a strong match");
  assert.equal(isVisible({ ...abroad, seniority: "senior" }, strong), false);
  assert.equal(isVisible({ ...abroad, family: "software" }, strong), false);
});

test("a role you marked or are tracking stays visible wherever it is", () => {
  const stretch = fitOf(need("diffusion"), need("slam"));
  assert.equal(isVisible(role({ location_tier: "abroad", interest: 3 }), stretch), true);
  assert.equal(isVisible(role({ location_tier: "abroad", stage: "applied" }), stretch), true);
});

test("general software needs to be a real fit to be shown", () => {
  assert.equal(isVisible(role({ family: "software" }), fitOf(need("diffusion"), need("slam"))), false);
  assert.equal(isVisible(role({ family: "software" }), fitOf(need("python"))), false);
  assert.equal(isVisible(role({ family: "software" }), strong), true);
});

test("closed roles, and ones you ruled out, leave the market", () => {
  const fit = strong;
  assert.equal(isTarget(role(), fit), true);
  assert.equal(isTarget(role({ closed_at: "2026-11-01" }), fit), false);
  assert.equal(isTarget(role({ stage: "passed" }), fit), false);
  assert.equal(isTarget(role({ interest: 0 }), fit), false);
});

test("demand ranks skills you lack above ones you have, weighted by what you want", () => {
  const rows = marketRows(
    [
      role({ gid: "1", interest: 3, requirements: [need("diffusion"), need("cpp")] }),
      role({ gid: "2", requirements: [need("slam"), need("cpp")] }),
      role({ gid: "3", requirements: [need("cpp"), need("slam", "preferred")] }),
    ],
    standings,
  );
  assert.equal(rows[0].skill.key, "diffusion", "wanted more, so ranked above SLAM");
  assert.equal(rows.find((r) => r.skill.key === "cpp")?.priority, 0, "you can already show it");
  assert.deepEqual([rows.find((r) => r.skill.key === "slam")?.must, rows.find((r) => r.skill.key === "slam")?.soft], [1, 1]);
});

test("a branch reports who asks for it and who it would move up", () => {
  const roles = [role({ interest: 2, requirements: [need("pytorch"), need("diffusion"), need("cpp")] }), role({ requirements: [need("cpp")] }), role({ requirements: [need("unreal", "preferred")] })];
  const ml = branchImpact(roles, standings).find((b) => b.key === "ml-3d");
  assert.equal(ml?.asking, 1);
  assert.equal(ml?.askingWanted, 1);
  assert.equal(ml?.unlocks, 1);
  assert.equal(branchImpact(roles, standings).find((b) => b.key === "real-time")?.asking, 1, "wanted counts as asking");
});

test("unknown terms need to appear in more than one role", () => {
  const terms = unknownTerms([role({ details: { unknownTerms: ["Kubeflow", "OneOff"] } }), role({ details: { unknownTerms: ["Kubeflow"] } })]);
  assert.deepEqual(terms, [{ term: "Kubeflow", roles: 2 }]);
});
