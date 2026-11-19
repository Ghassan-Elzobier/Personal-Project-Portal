import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesSection, tapsFrom, type PageFacts } from "./brief.ts";
import { FOCI } from "./foci.ts";

// A page can be shot twice for review: as seeded, and in a state a test set up
// first (Money with a bank connected). The brief lists both, says which is which,
// and marks both for the focus that owns the page.

const page = (path: string, links: string[], more: Partial<PageFacts> = {}): PageFacts => ({
  path,
  shot: `${path === "/" ? "today" : path.slice(1).replace(/\//g, "-")}.png`,
  screens: 1,
  tapTargets: 15,
  under24: 0,
  under48: 4,
  links,
  headings: [],
  words: 40,
  jsKb: 300,
  requests: 20,
  lcpMs: 400,
  cls: 0,
  ...more,
});
const connected = page("/life/money", ["/", "/claude"], {
  state: "bank connected",
  shot: "life-money-connected.png",
  screens: 13.2,
  tapTargets: 62,
  words: 600,
});
const pages = [
  page("/", ["/life"]),
  page("/life", ["/life/money"]),
  connected,
  page("/life/money", []),
  page("/claude", []),
];

test("a page shot in a set-up state is listed beside its seeded one, and says what was set up", () => {
  const money = FOCI.find((f) => f.id === "money") ?? FOCI[0];
  const rows = pagesSection(pages, money).split("\n").slice(2);
  assert.equal(rows.length, pages.length);
  // The focus's own page first: as seeded, then as set up, both marked.
  assert.match(rows[0], /^\| \/life\/money ★ \| life-money\.png \| 2 \| 1 \| 15 \(0 \/ 4\) \|/);
  assert.match(
    rows[1],
    /^\| \/life\/money \(bank connected\) ★ \| life-money-connected\.png \| 2 \| 13\.2 \| 62 \(0 \/ 4\) \|/,
  );
});

test("taps are counted from the links of the seeded page, where everyone starts", () => {
  // Only the connected Money page links to /claude: it is not a tap from Today.
  for (const order of [pages, [...pages].reverse()]) {
    const taps = tapsFrom("/", order);
    assert.equal(taps.get("/life/money"), 2);
    assert.equal(taps.has("/claude"), false);
  }
});
