import { expect, test } from "@playwright/test";

// The Learn pages show what Claude taught through the connector: the seeded
// lesson has a plan, three answers (one a confident miss) and no claims.
test("a lesson opens from the list and shows its plan and answers", async ({ page }) => {
  await page.goto("/study/learn");
  await page.getByRole("link", { name: /why tiling cuts memory traffic/i }).click();

  await expect(page.getByRole("heading", { level: 1, name: /why tiling cuts memory traffic/i })).toBeVisible();
  await expect(page.getByText("1 of 2 right, 1 sure but wrong").first()).toBeVisible();
  await expect(page.getByText("After: Memory is slow, Threads reuse a tile")).toBeVisible();
  await expect(page.getByText("Sure but wrong", { exact: true })).toBeVisible();
  await expect(page.getByText("Did not know")).toBeVisible();
  await expect(page.getByText("Nothing was saved from this lesson.")).toBeVisible();
});

test("a lesson that does not exist is a not-found page", async ({ page }) => {
  const response = await page.goto("/study/learn/999999");
  expect(response?.status()).toBe(404);
});
