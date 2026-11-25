import { expect, test } from "@playwright/test";
import { FIXED_NOW } from "./env";

// Applications opens with the search week by week: the last eight weeks, each with
// how many were sent, and one line summing them up. It is a record, not a quota.
// The weeks' dates are unit-tested (src/lib/jobs/rhythm.test.ts); the suite's
// database stamps applied_on with its own date, so this checks the shape only.
// Runs at the Pixel 7's 412 px, the 360 px small phone and desktop (playwright.config.ts).

test("Applications shows eight weeks of applications and a summary line", async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.goto("/jobs?view=applications");
  const region = page.getByRole("region", { name: "Your search, week by week" });
  await expect(region).toBeVisible();
  await expect(region.getByRole("listitem")).toHaveCount(8);
  await expect(region.getByText(/sent in(?: the last)? 8 weeks/)).toBeVisible();
  await expect(region.getByRole("listitem").last()).toContainText("This week");

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, "the page does not scroll sideways").toBe(false);
});
