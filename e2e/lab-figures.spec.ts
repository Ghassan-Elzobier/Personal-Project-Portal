import { expect, test } from "@playwright/test";
import { FIXED_NOW } from "./env";

// Screenshots of every Lab figure, so a change to the figures' type, colours or
// layout shows up in review, and a refactor can prove it changed none of them.
// Desktop only: there each figure shows whole, while phones scroll it sideways.

const FIGURES = [
  "frame",
  "objects",
  "timeline",
  "sync",
  "dispatch",
  "invocation",
  "divergence",
  "memory",
  "accumulation",
  "shader-build",
  "memory-binding",
  "swapchain",
  "timing",
  "camera",
  "intersection",
  "bounce",
  "random",
];

// Hidden in screenshots: the loading bar's animation and toasts (e2e/screenshot.css).
const HIDE = "e2e/screenshot.css";

test.describe("lab figures", () => {
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "figures are compared at desktop width");
    await page.clock.setFixedTime(new Date(FIXED_NOW));
  });

  for (const id of FIGURES) {
    test(`${id} figure looks as approved`, async ({ page }) => {
      await page.goto(`/lab/${id}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("region", { name: "Figure" })).toHaveScreenshot(`lab-${id}.png`, {
        stylePath: HIDE,
      });
    });
  }
});
