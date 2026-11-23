import { expect, test, type Page } from "@playwright/test";

// A fresh week's shop moves to another day, and the week moves with it: the cook
// that needed its food goes to after it. It shows at once and after a reload, and
// Undo puts the shop and the cook back. Next week, so this week (and the Meals
// screenshot) is left as it is; next week is planned afresh at the end.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

// A planned fresh week's chip. The plan card's own "Fresh week" option shows before
// anything is saved, so waiting for that text alone can move on mid-save.
const freshWeek = (page: Page) =>
  page.getByRole("region", { name: "The week's cooking" }).getByText("Fresh week", { exact: true });

/** Next week as a fresh week straight from the routine: shops on Sunday and Wednesday, short cooks at 18:00. */
async function aFreshWeekNext(page: Page) {
  await page.goto("/life?week=next");
  const plan = page.getByRole("button", { name: "Plan a fresh week" });
  const make = page.getByRole("button", { name: "Make it a fresh week" });
  if (await plan.isVisible()) await plan.click();
  else if (await make.isVisible()) await make.click();
  else {
    // A fresh week already, perhaps with its shops moved: plan it afresh.
    await page.getByRole("button", { name: "Pick again" }).click();
    await expect(page.getByText("Re-planned.")).toBeVisible();
  }
  await expect(freshWeek(page)).toBeVisible();
}

/** Moves a shop with the Kitchen's Move: its day by the picker's label, and its time. */
async function moveShop(page: Page, shop: string, day: string, time: string) {
  const card = page.getByRole("region", { name: shop });
  await card.getByRole("button", { name: "Move", exact: true }).click();
  await card.getByLabel("Day").selectOption({ label: day });
  await card.getByLabel("Time").fill(time);
  await card.getByRole("button", { name: "Move shop" }).click();
}

test("a shop moved to another day takes the cook that needs its food along, at once and after a reload, and Undo puts the week back", async ({
  page,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await aFreshWeekNext(page);
  const toCook = page.getByRole("region", { name: "To cook" });
  const sundayCook = toCook.getByText(/^Sunday 22 Nov · /);
  await page.goto("/life/kitchen?tab=fridge&week=next");
  await expect(sundayCook).toBeVisible();

  // Sunday's shop to Monday at 11:00: Sunday's cook can't happen before its food, so it moves to Monday evening.
  await page.goto("/life/kitchen?week=next");
  await moveShop(page, "Sunday's shop", "Monday 23 Nov", "11:00");
  const monday = page.getByRole("region", { name: "Monday's shop" });
  await expect(monday.getByText("Monday 23 Nov · 11:00")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sunday's shop" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Wednesday's shop" })).toBeVisible();
  await expect(page.getByText(/^Shop moved to Monday 11:00\. .+ moves to Monday 18:00\./)).toBeVisible();

  // Undo: the shop is back on Sunday, at once and after a reload.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const sunday = page.getByRole("region", { name: "Sunday's shop" });
  await expect(sunday.getByText("Sunday 22 Nov · 10:00")).toBeVisible();
  await expect(monday).toHaveCount(0);
  await page.reload();
  await expect(sunday.getByText("Sunday 22 Nov · 10:00")).toBeVisible();
  await page.goto("/life/kitchen?tab=fridge&week=next");
  await expect(sundayCook).toBeVisible();

  // Moved again, it stays moved after a reload, and Sunday has no cook left.
  await page.goto("/life/kitchen?week=next");
  await moveShop(page, "Sunday's shop", "Monday 23 Nov", "11:00");
  await expect(monday.getByText("Monday 23 Nov · 11:00")).toBeVisible();
  await page.reload();
  await expect(monday.getByText("Monday 23 Nov · 11:00")).toBeVisible();
  await page.goto("/life/kitchen?tab=fridge&week=next");
  await expect(toCook.getByText(/^Monday 23 Nov · /).first()).toBeVisible();
  await expect(sundayCook).toHaveCount(0);

  // Back as the routine has it.
  await aFreshWeekNext(page);
  await page.goto("/life/kitchen?week=next");
  await expect(page.getByRole("region", { name: "Sunday's shop" })).toBeVisible();
});
