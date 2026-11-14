import { expect, test } from "@playwright/test";

// The seed the Playwright agents (planner, generator, healer; .claude/agents) run
// first to get a ready page: the app, signed in as the seeded owner (the project's
// storage state), on its home page. Generated tests copy this shape.
test("seed: the signed-in portal is ready", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
});
