import { expect, test, type Page } from "@playwright/test";

// A set added with "+ Add a set" and then ticked is one more set, not two: the card
// once counted the logged set and the tap that added it, so an empty row appeared
// under the set you had just done. The test adds a set, ticks it, lets the save land,
// and takes the tick off again at the end.

test.setTimeout(60_000);

const firstCard = (page: Page) =>
  page
    .locator("article")
    .filter({ has: page.getByRole("heading", { level: 3 }) })
    .first();

test("ticking a set added with + Add a set leaves one row for it, before and after a reload", async ({ page }) => {
  await page.goto("/life/gym");
  const card = firstCard(page);
  const rows = card.locator("ol > li");
  const before = await rows.count();
  const added = before + 1;

  await card.getByRole("button", { name: "+ Add a set", exact: true }).click();
  await expect(rows).toHaveCount(added);
  const tick = card.getByRole("button", { name: `Done set ${added}`, exact: true });
  try {
    // The save is a server action: wait for its answer and the page it brings back.
    const saved = page.waitForResponse(
      (r) => r.request().method() === "POST" && "next-action" in r.request().headers(),
    );
    await tick.click();
    await saved;
    await expect(card.getByRole("button", { name: `Undo set ${added}`, exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(rows, "no empty row appears under the set just done").toHaveCount(added);

    await page.reload();
    await expect(firstCard(page).locator("ol > li")).toHaveCount(added);
  } finally {
    // Back as it was: the added set's tick comes off, and after a reload so does its row.
    const undo = firstCard(page).getByRole("button", { name: `Undo set ${added}`, exact: true });
    if (await undo.count()) {
      const removed = page.waitForResponse(
        (r) => r.request().method() === "POST" && "next-action" in r.request().headers(),
      );
      await undo.click();
      await removed;
    }
  }
  await page.reload();
  await expect(firstCard(page).locator("ol > li")).toHaveCount(before);
});
