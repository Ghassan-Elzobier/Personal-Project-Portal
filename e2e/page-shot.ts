import { expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { PageFacts } from "../src/lib/rnd/brief.ts";
import { FIXED_NOW } from "./env";

// A page as the owner sees it on a Pixel 7, kept for review: a full-page screenshot
// and, beside it, the facts a design review needs (how long the page is, how much
// there is to tap and how much of it is small, where it links, how heavy it is).
// Nothing is compared with a baseline. CI keeps the files as the "page-shots"
// artifact, and the R&D agent (.claude/agents/rnd.md) reviews the newest from main.
// e2e/page-shots.spec.ts captures every page as seeded; a test that has set a page
// up first (a bank connected, say) captures that state too, under its own name.

const OUT = "test-results/page-shots";
const HIDE = readFileSync("e2e/screenshot.css", "utf8");

/** "/" becomes today, "/life/gym" life-gym. */
const fileName = (path: string) =>
  path === "/"
    ? "today"
    : path
        .slice(1)
        .replace(/[^a-z0-9]+/gi, "-")
        .slice(0, 60);

/**
 * Opens `path` and keeps it for review. `state` is for a page a test has set up
 * first: `name` goes on the file ("life-money-connected") and `label` says what
 * was set up ("bank connected"), so the review knows which page it is looking at.
 */
export async function captureForReview(page: Page, path: string, state?: { name: string; label: string }) {
  // Counted from Playwright's side: page.clock replaces the page's own performance
  // timeline, which then lists no requests at all.
  const finished: Promise<{ type: string; bytes: number }>[] = [];
  page.on("requestfinished", (request) =>
    finished.push(
      request.sizes().then(
        (sizes) => ({ type: request.resourceType(), bytes: sizes.responseBodySize }),
        () => ({ type: request.resourceType(), bytes: 0 }),
      ),
    ),
  );
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  const response = await page.goto(path);
  expect(response?.status(), "status").toBeLessThan(400);
  await page.evaluate(() => document.fonts.ready);
  // What the page loaded, before anything the screenshot sets off (such as prefetches).
  const loaded = await Promise.all([...finished]);
  const scriptBytes = loaded.filter((r) => r.type === "script").reduce((sum, r) => sum + r.bytes, 0);

  const name = state ? `${fileName(path)}-${state.name}` : fileName(path);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, style: HIDE });

  const seen: Omit<PageFacts, "path" | "state" | "shot" | "jsKb" | "requests"> = await page.evaluate(async () => {
    // Visible and bigger than the one-pixel boxes that hide text for screen readers.
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
    };
    const targets = [
      ...document.querySelectorAll(
        "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox]",
      ),
    ].filter(shown);
    const boxes = targets.map((el) => el.getBoundingClientRect());
    const links = targets
      .filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement)
      .map((a) => new URL(a.href))
      .filter((url) => url.origin === location.origin)
      .map((url) => url.pathname + url.search);
    const headings = [...document.querySelectorAll("h1, h2, h3")]
      .filter(shown)
      .map((h) => `${h.tagName.toLowerCase()}: ${(h.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}`);
    // Entries recorded so far; a page with none of a kind answers after half a second.
    const recorded = (type: string) =>
      new Promise<PerformanceEntry[]>((resolve) => {
        new PerformanceObserver((list) => resolve(list.getEntries())).observe({ type, buffered: true });
        setTimeout(() => resolve([]), 500);
      });
    const lcp = (await recorded("largest-contentful-paint")).at(-1)?.startTime ?? 0;
    const shifts = (await recorded("layout-shift")) as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
    })[];
    return {
      screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10,
      tapTargets: targets.length,
      under24: boxes.filter((r) => r.width < 24 || r.height < 24).length,
      under48: boxes.filter((r) => r.width < 48 || r.height < 48).length,
      links: [...new Set(links)].sort(),
      headings: headings.slice(0, 40),
      words: (document.querySelector("main")?.innerText ?? "").split(/\s+/).filter(Boolean).length,
      lcpMs: Math.round(lcp),
      cls: Math.round(shifts.reduce((sum, s) => sum + (s.hadRecentInput ? 0 : s.value), 0) * 1000) / 1000,
    };
  });
  const facts: PageFacts = {
    path,
    ...(state ? { state: state.label } : {}),
    shot: `${name}.png`,
    ...seen,
    jsKb: Math.round(scriptBytes / 1024),
    requests: loaded.length,
  };
  writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify(facts, null, 2)}\n`);
  return facts;
}
