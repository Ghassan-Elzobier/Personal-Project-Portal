import { expect, test } from "@playwright/test";
import { FIXED_NOW } from "./env";

// Screenshots that make design changes visible in review. A pull request that
// changes how these look must include the new images, which GitHub shows side
// by side. A refactor must change none of them: that is how a refactor proves
// it kept behaviour. Update baselines only on purpose, with
// `npm run test:e2e:update` (renders in the same Linux image as CI).

// Pages that render the same on every run: no live feeds, a pinned clock and
// the seeded test data.
const PAGES = [
  { name: "design", path: "/design" },
  { name: "today", path: "/" },
  { name: "meals", path: "/life" },
  { name: "recipes", path: "/life/recipes" },
];

// Hidden in screenshots: the loading bar's animation and toasts (e2e/screenshot.css).
const HIDE = "e2e/screenshot.css";

test.describe("screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_NOW));
  });

  for (const { name, path } of PAGES) {
    test(`${name} looks as approved`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, stylePath: HIDE });
    });
  }

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test("login looks as approved", async ({ page }) => {
      await page.goto("/login");
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot("login.png", { fullPage: true, stylePath: HIDE });
    });
  });
});
