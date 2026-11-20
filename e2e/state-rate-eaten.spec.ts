import { expect, test } from "@playwright/test";
import { ownerDatabase } from "./owner-database";

// "How was it?": a dish eaten this week and not rated asks for a star on the Meals
// page; one tap rates it, at once and after a reload, and the recipe shows it. The
// eaten meal is set up through the database and both are cleared after.

test.describe.configure({ mode: "serial" });

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

test("a dish eaten this week is rated from the Meals page in one tap", async ({ page }) => {
  const db = await ownerDatabase();
  await db.call("life_log_meal", { p_day: TODAY, p_slot: "lunch", p_status: "eaten", p_recipe: "bolognese" });
  try {
    await page.goto("/life");
    const card = page.getByRole("region", { name: "How was it?" });
    await expect(card.getByRole("link", { name: "Spaghetti bolognese" })).toBeVisible();
    await card.getByRole("radio", { name: "4 stars" }).click();
    await expect(page.getByText("Thanks: the plan will remember.")).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "How was it?" })).toHaveCount(0);

    await page.goto("/life/recipes/bolognese");
    await expect(page.getByRole("radiogroup", { name: "4 of 5 stars" })).toBeVisible();
  } finally {
    await db.call("life_rate", { p_recipe: "bolognese", p_stars: null, p_note: null });
    await db.call("life_log_meal", { p_day: TODAY, p_slot: "lunch", p_status: null });
  }
});
