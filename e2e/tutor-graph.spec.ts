import { expect, test } from "@playwright/test";

// The graph page opens from the Learn page. The seed has a lesson but no claims,
// because the tutor's database tests count them, so this is the empty state.
test("the knowledge graph opens from the Learn page and starts empty", async ({ page }) => {
  await page.goto("/study/learn");
  await page.getByRole("link", { name: /as a graph/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge graph" })).toBeVisible();
  await expect(page.getByText(/Nothing here yet/)).toBeVisible();
});
