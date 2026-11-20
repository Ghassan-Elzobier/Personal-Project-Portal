import { test } from "@playwright/test";
import { OWNER_PAGES } from "./env";
import { captureForReview } from "./page-shot";

// Every owner page as the owner sees it on a Pixel 7, with the facts a design
// review needs: how long the page is, how much there is to tap and how much of it
// is small, where it links, and how heavy it is. Nothing is compared with a
// baseline (visual.spec.ts holds the approved look): CI keeps these files as the
// "page-shots" artifact, and the R&D agent (.claude/agents/rnd.md) reviews the
// newest from main. Runs in the pixel-7 project only (playwright.config.ts).
// The capture itself is in e2e/page-shot.ts, so a test that sets a page up first
// can keep that state for review too.

for (const { path } of OWNER_PAGES) {
  test(`${path} is captured for review`, async ({ page }) => {
    await captureForReview(page, path);
  });
}
