import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { PageFacts } from "../src/lib/rnd/brief.ts";
import { FIXED_NOW, OWNER_PAGES } from "./env";

// Every owner page as the owner sees it on a Pixel 7, with the facts a design
// review needs: how long the page is, how much there is to tap and how much of it
// is small, where it links, and how heavy it is. Nothing is compared with a
// baseline (visual.spec.ts holds the approved look): CI keeps these files as the
// "page-shots" artifact, and the R&D agent (.claude/agents/rnd.md) reviews the
// newest from main. Runs in the pixel-7 project only (playwright.config.ts).

const OUT = "test-results/page-shots";
const HIDE = readFileSync("e2e/screenshot.css", "utf8");

/** "/" becomes today.png, "/life/gym" life-gym.png. */
const fileName = (path: string) =>
  path === "/"
    ? "today"
    : path
        .slice(1)
        .replace(/[^a-z0-9]+/gi, "-")
        .slice(0, 60);

for (const { path } of OWNER_PAGES) {
  test(`${path} is captured for review`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    const response = await page.goto(path);
    expect(response?.status(), "status").toBeLessThan(400);
    await page.evaluate(() => document.fonts.ready);

    const name = fileName(path);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, style: HIDE });

    const facts: Omit<PageFacts, "path" | "shot"> = await page.evaluate(async () => {
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
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const js = resources
        .filter((r) => r.initiatorType === "script" || /\.js(?:\?|$)/.test(r.name))
        .reduce((sum, r) => sum + r.encodedBodySize, 0);
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
        jsKb: Math.round(js / 1024),
        requests: resources.length + 1,
        lcpMs: Math.round(lcp),
        cls: Math.round(shifts.reduce((sum, s) => sum + (s.hadRecentInput ? 0 : s.value), 0) * 1000) / 1000,
      };
    });
    writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify({ path, shot: `${name}.png`, ...facts }, null, 2)}\n`);
  });
}
