import { expect, test } from "@playwright/test";

// Lessons Claude taught sit under Work's More menu, so the Learn page is one menu away.
test("the phone's More menu opens Lessons, and More stays current there", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "The tab bar is the phone's nav");
  await page.goto("/study");
  const bar = page.locator("nav[aria-label='Main']").last();
  await bar.locator("summary", { hasText: "More" }).click();
  await bar.getByRole("link", { name: "Lessons", exact: true }).click();
  await expect(page).toHaveURL(/\/study\/learn$/);
  await expect(page.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();
  await expect(bar.locator("summary", { hasText: "More" })).toHaveAttribute("aria-current", "true");
  await expect(bar.getByRole("link", { name: "Study", exact: true })).not.toHaveAttribute("aria-current", /.+/);
});

test("the desktop More menu opens Lessons, and More stays current there", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The top bar's links show on desktop");
  await page.goto("/study");
  const bar = page.locator("nav[aria-label='Main']").first();
  await bar.locator("summary", { hasText: "More" }).click();
  await bar.getByRole("link", { name: "Lessons", exact: true }).click();
  await expect(page).toHaveURL(/\/study\/learn$/);
  await expect(page.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();
  await expect(bar.locator("summary", { hasText: "More" })).toHaveAttribute("aria-current", "true");
  await expect(bar.getByRole("link", { name: "Study", exact: true })).not.toHaveAttribute("aria-current", /.+/);
});
