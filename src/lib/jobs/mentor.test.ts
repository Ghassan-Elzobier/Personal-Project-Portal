import assert from "node:assert/strict";
import test from "node:test";
import type { Requirement } from "./extract.ts";
import { mentorJobView, type MentorSource } from "./mentor.ts";

const need = (
  skill: string,
  level: Requirement["level"] = "required",
  group = skill.length * 100 + skill.charCodeAt(0),
): Requirement => ({ skill, level, quote: "", group });
const posting = (
  gid: string,
  over: Partial<MentorSource["postings"][number]> = {},
): MentorSource["postings"][number] => ({
  gid,
  title: `Role ${gid}`,
  company: "Co",
  location_tier: "london",
  family: "graphics",
  seniority: "any",
  closed_at: null,
  stage: "new",
  interest: null,
  details: {},
  requirements: [need("cpp"), need("python"), need("vulkan")],
  ...over,
});

const source: MentorSource = {
  postings: [
    posting("1"),
    posting("2", { title: "Role 1", location_tier: "abroad" }),
    posting("3", { requirements: [need("cpp"), need("diffusion"), need("python")], stage: "applied" }),
    posting("4", { requirements: [need("diffusion"), need("slam"), need("pytorch")], stage: "saved" }),
    posting("5", { stage: "passed" }),
    posting("6", { interest: 0 }),
  ],
  evidence: [
    { gid: "e1", skill: "cpp", level: 4, note: "Public renderer", url: "https://example.test/r" },
    { gid: "e2", skill: "python", level: 2, note: "", url: null },
    { gid: "e3", skill: "vulkan", level: 4, note: "Public renderer", url: "https://example.test/r" },
  ],
  units: [{ ref: "r-nerf-tiny", done: false, due_on: "2027-04-01", solved: 0, measured: false }],
  last_read: "2026-11-06T09:00:00Z",
};

test("the same role posted in two places counts once, at the nearer place", () => {
  const view = mentorJobView(source);
  assert.equal(view.closest.filter((r) => r.title === "Role 1").length, 1);
  assert.equal(view.closest.find((r) => r.title === "Role 1")?.location_tier, "london");
});

test("roles you passed on or ruled out are not in scope", () => {
  const view = mentorJobView(source);
  assert.equal(view.inScope, 3);
});

test("the closest roles come first, by fit", () => {
  const view = mentorJobView(source);
  assert.deepEqual(
    view.closest.map((r) => [r.title, r.fit.band]),
    [
      ["Role 1", "ready"],
      ["Role 3", "one_gap"],
    ],
  );
});

test("the skills gap uses the same matching as your own pages", () => {
  const view = mentorJobView(source);
  assert.equal(view.gaps[0].skill.key, "diffusion");
  assert.equal(view.gaps[0].must, 2);
  assert.ok(view.coming.some((m) => m.skill.key === "pytorch" && m.standing.next?.dueOn === "2027-04-01"));
  assert.ok(view.showing.some((m) => m.skill.key === "cpp"));
});

test("units carry no links, since a mentor cannot open your study panels", () => {
  const view = mentorJobView(source);
  assert.equal(view.coming.find((m) => m.skill.key === "pytorch")?.standing.next?.href, null);
});

test("applications are counted by stage", () => {
  const view = mentorJobView(source);
  assert.deepEqual(view.pipeline, { saved: 1, applied: 1, interview: 0, offer: 0, rejected: 0 });
  assert.deepEqual(view.applications.map((r) => r.title).sort(), ["Role 3", "Role 4"]);
});

test("reasons are written about him, not to him", () => {
  const view = mentorJobView(source);
  const reasons = view.closest.map((r) => r.fit.reason).join(" ");
  assert.ok(!/\byou(r)?\b/i.test(reasons), reasons);
  assert.match(reasons, /Can show C\+\+/);
  assert.match(reasons, /Not in the plan: Diffusion models/);
});
