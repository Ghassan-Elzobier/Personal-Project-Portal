import { expect, test } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// A regular cost as a goal: the owner adds one, and its card says the first payday it
// fits, its price a week and a month, and the same after a reload. Then a start day the
// owner sets is kept. Like the other Money tests it connects the made-up bank and erases
// it again, so the Money screenshots stay as approved. The suite's clock is Monday
// 16 November 2026: pay comes on the last working day, so the next payday is 30 Nov.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test("a regular cost added on Money says when it fits, at once and after a reload, and holds at 360 px", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=100000`);
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const pay = page.getByRole("region", { name: "Your pay" });
  const goals = page.getByRole("region", { name: "Goals" });
  const card = goals.getByRole("listitem").filter({ hasText: "Example swim" });
  try {
    await pay.getByRole("combobox", { name: /^From the payday on/ }).selectOption("2026-11-30");
    await pay.getByLabel("Take-home a month (£)").fill("2000");
    await pay.getByRole("button", { name: "Save the pay" }).click();
    await expect(pay.getByText("£2,000.00 a month from 30 Nov")).toBeVisible();

    await goals.getByText("Add a goal").click();
    await goals.getByLabel("What it's for").fill("Example swim");
    await goals.getByRole("combobox", { name: "Kind" }).selectOption("recurring");
    await goals.getByLabel("It costs (£)").fill("40");
    await goals.getByRole("combobox", { name: /^How often/ }).selectOption("monthly");
    await goals.getByLabel("Setup cost (£, optional)").fill("25");
    await goals.getByRole("button", { name: "Add the goal" }).click();

    await expect(card.getByText("£9.23 a week, £40.00 a month · Regular cost")).toBeVisible();
    await expect(card.getByText("Fits from payday 30 Nov")).toBeVisible();
    await page.reload();
    await expect(card.getByText("£9.23 a week, £40.00 a month · Regular cost")).toBeVisible();
    await expect(card.getByText("Fits from payday 30 Nov")).toBeVisible();

    await page.setViewportSize({ width: 360, height: 780 });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText("Fits from payday 30 Nov")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "nothing pushes the page sideways",
    ).toBeLessThanOrEqual(360);
  } finally {
    // Back as it was: the cost and the pay removed, the bank data erased.
    await page.goto("/life/money");
    const remove = goals.getByRole("button", { name: "Remove Example swim" });
    if ((await remove.count()) > 0) {
      await remove.click();
      await expect(remove).toHaveCount(0);
    }
    const removePay = pay.getByRole("button", { name: "Remove the pay from 30 Nov" });
    if ((await removePay.count()) > 0) {
      await removePay.click();
      await expect(removePay).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
