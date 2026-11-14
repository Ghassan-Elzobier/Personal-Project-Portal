import { expect, test } from "@playwright/test";

// Switching between List and Board on Tasks works in both directions, keeps the
// project, and the page shows the view the address says (found by the owner:
// Board switched, List did not switch back).

test("List and Board switch back and forth", async ({ page }) => {
  await page.goto("/tasks");
  const group = page.getByRole("group", { name: "View" });
  const list = group.getByRole("link", { name: "List" });
  const board = group.getByRole("link", { name: "Board" });
  await expect(list).toHaveAttribute("aria-current", "true");

  await board.click();
  await expect(page).toHaveURL(/view=board/);
  await expect(board).toHaveAttribute("aria-current", "true");

  await list.click();
  await expect(page).not.toHaveURL(/view=board/);
  await expect(list).toHaveAttribute("aria-current", "true");
  await expect(board).not.toHaveAttribute("aria-current", "true");

  await board.click();
  await expect(board).toHaveAttribute("aria-current", "true");
});

test("the view survives a change of project, and a reload", async ({ page }) => {
  await page.goto("/tasks?view=board");
  await page.getByRole("navigation", { name: "Projects" }).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/view=board/);
  await page.reload();
  await expect(page.getByRole("group", { name: "View" }).getByRole("link", { name: "Board" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});
