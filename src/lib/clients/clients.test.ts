import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanOptional,
  cleanText,
  cleanUrl,
  clientTree,
  isAmount,
  isDay,
  isStage,
  isTimeZone,
  money,
  nextMilestone,
  parsePounds,
  summary,
  type Client,
  type ClientProject,
  type Milestone,
} from "./clients.ts";

// Every client, project and amount here is made up.

const client = (gid: number, name: string): Client => ({
  gid: String(gid),
  name,
  relationship: "referral",
  channel: null,
  timeZone: null,
  notes: null,
});

const project = (gid: number, clientGid: number, title: string, stage: ClientProject["stage"]): ClientProject => ({
  gid: String(gid),
  clientGid: String(clientGid),
  title,
  stage,
  pricing: "fixed",
  repoUrl: null,
  previewUrl: null,
  liveUrl: null,
  notes: null,
});

const milestone = (
  gid: number,
  projectGid: number,
  dueOn: string | null,
  amountPence: number | null,
  acceptedOn: string | null = null,
  paidOn: string | null = null,
): Milestone => ({
  gid: String(gid),
  projectGid: String(projectGid),
  title: `Example milestone ${gid}`,
  dueOn,
  amountPence,
  acceptedOn,
  paidOn,
});

test("the next milestone is the soonest one not yet accepted, with undated ones last", () => {
  const ms = [
    milestone(1, 1, "2026-12-01", 100, "2026-12-01"),
    milestone(2, 1, null, 100),
    milestone(3, 1, "2027-01-15", 100),
    milestone(4, 1, "2026-12-20", 100),
  ];
  assert.equal(nextMilestone(ms)?.gid, "4");
  assert.equal(nextMilestone([milestone(5, 1, null, null), milestone(6, 1, null, null)])?.gid, "5");
  assert.equal(nextMilestone([milestone(7, 1, "2026-12-01", 100, "2026-12-02")]), null, "all accepted: nothing next");
  assert.equal(nextMilestone([]), null);
});

test("a project's money is everything agreed, what was paid, and what was accepted but not paid", () => {
  assert.deepEqual(
    money([
      milestone(1, 1, null, 50_000, "2026-12-01", "2026-12-05"),
      milestone(2, 1, null, 30_000, "2026-12-10"),
      milestone(3, 1, null, 20_000),
      milestone(4, 1, null, null),
    ]),
    { agreedPence: 100_000, paidPence: 50_000, owedPence: 30_000 },
  );
  assert.deepEqual(money([]), { agreedPence: 0, paidPence: 0, owedPence: 0 });
});

test("the tree nests projects under clients and milestones under projects, live work first", () => {
  const tree = clientTree({
    clients: [client(1, "Example Zed"), client(2, "Example Aunt"), client(3, "Example Old")],
    projects: [
      project(10, 1, "Example app", "lead"),
      project(11, 1, "Example site", "building"),
      project(12, 1, "Example retired", "closed"),
      project(20, 2, "Example glossary", "scoping"),
      project(30, 3, "Example done", "closed"),
    ],
    milestones: [milestone(100, 11, "2026-12-20", 1000), milestone(101, 11, "2026-12-01", 2000)],
  });
  assert.deepEqual(
    tree.map((c) => c.name),
    ["Example Aunt", "Example Zed", "Example Old"],
    "clients with live work first, then by name",
  );
  assert.deepEqual(
    tree[1].projects.map((p) => p.title),
    ["Example app", "Example site", "Example retired"],
    "live projects in stage order, closed last",
  );
  const site = tree[1].projects[1];
  assert.deepEqual(
    site.milestones.map((m) => m.gid),
    ["101", "100"],
    "milestones soonest first",
  );
  assert.equal(site.next?.gid, "101");
  assert.equal(site.agreedPence, 3000);
  assert.deepEqual(tree[0].projects[0].milestones, [], "a project with no milestones has an empty list");
});

test("the summary counts live projects, adds up what is owed, and finds the soonest milestone anywhere", () => {
  const tree = clientTree({
    clients: [client(1, "Example One"), client(2, "Example Two")],
    projects: [
      project(10, 1, "Example app", "building"),
      project(11, 1, "Example closed", "closed"),
      project(20, 2, "Example glossary", "scoping"),
    ],
    milestones: [
      milestone(100, 10, "2026-12-20", 40_000, "2026-12-01"),
      milestone(101, 10, "2027-01-10", 60_000),
      milestone(200, 20, "2026-12-05", null),
      milestone(110, 11, "2026-11-30", 5_000),
    ],
  });
  const s = summary(tree);
  assert.equal(s.liveProjects, 2);
  assert.equal(s.owedPence, 40_000);
  assert.deepEqual(
    s.next && { client: s.next.client, project: s.next.project, gid: s.next.milestone.gid },
    { client: "Example Two", project: "Example glossary", gid: "200" },
    "a closed project's milestone never counts as next",
  );
  assert.deepEqual(summary([]), { liveProjects: 0, owedPence: 0, next: null });
});

test("amounts typed in pounds become pence, blank is none, and anything else is refused", () => {
  assert.equal(parsePounds("1500"), 150_000);
  assert.equal(parsePounds("£1,500.50"), 150_050);
  assert.equal(parsePounds(" 250.5 "), 25_050);
  assert.equal(parsePounds(""), null);
  assert.equal(parsePounds("   "), null);
  assert.equal(parsePounds("12.345"), undefined);
  assert.equal(parsePounds("-5"), undefined);
  assert.equal(parsePounds("lots"), undefined);
  assert.equal(parsePounds("99999999"), undefined, "over a million pounds is not taken");
  assert.equal(isAmount(0), true);
  assert.equal(isAmount(1.5), false);
});

test("text is trimmed to its limit, optional text may be blank, and links must be https", () => {
  assert.equal(cleanText("  Example  ", 120), "Example");
  assert.equal(cleanText("   ", 120), null);
  assert.equal(cleanText("x".repeat(121), 120), null);
  assert.equal(cleanText(5, 120), null);

  assert.equal(cleanOptional("  WhatsApp ", 80), "WhatsApp");
  assert.equal(cleanOptional("", 80), null);
  assert.equal(cleanOptional(null, 80), null);
  assert.equal(cleanOptional("x".repeat(81), 80), undefined);
  assert.equal(cleanOptional(3, 80), undefined);

  assert.equal(cleanUrl("https://example.test/repo"), "https://example.test/repo");
  assert.equal(cleanUrl(" "), null);
  assert.equal(cleanUrl("http://example.test"), undefined);
  assert.equal(cleanUrl("https://example.test/a b"), undefined);
});

test("days must be real, and stages must be known", () => {
  assert.equal(isDay("2026-12-18"), true);
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("18/12/2026"), false);
  assert.equal(isStage("building"), true);
  assert.equal(isStage("dreaming"), false);
  assert.equal(isTimeZone("Europe/Paris"), true);
  assert.equal(isTimeZone("Mars/Olympus_Mons"), false);
});
