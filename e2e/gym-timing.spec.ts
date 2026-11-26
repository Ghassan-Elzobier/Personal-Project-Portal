import { expect, test } from "@playwright/test";

// A session has to fit the time you have, so the gym page says how long each part
// takes: the warm-up and the recovery with their minutes, minutes on every block,
// and the extras marked optional, the first thing to drop. It only reads the page.

test("the session gives minutes for the warm-up, every block and the recovery, and marks the extras optional", async ({
  page,
}) => {
  await page.goto("/life/gym");
  await expect(page.getByText(/^About \d+ minutes/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Warm-up · \d+ min$/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Recovery · \d+ min$/ })).toBeVisible();

  const blocks = page.locator("section[aria-label]").filter({ has: page.locator("article") });
  expect(await blocks.count()).toBeGreaterThan(2);
  for (const block of await blocks.all())
    await expect(block.getByRole("heading", { level: 2 })).toContainText(/ · \d+ min/);
  await expect(page.getByText(/^Optional/).first()).toBeVisible();

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, "the page does not scroll sideways").toBe(false);
});
