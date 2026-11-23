import { expect, test } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// Payments fold into money weeks. This week and last week start open, so their rows
// show without a tap; an older week starts closed, its header still saying what went
// out, came in and is still to sort, and it opens by tap or by keyboard. Sorting a
// payment takes it off its week's count at once. Like the other Money tests it
// connects the made-up bank and erases it again, so the Money screenshot stays as approved.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("payments fold into weeks: recent ones open, an older one closed with its totals, and the count to sort updates at once", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const [market, gym, shop] = ["EXAMPLE MARKET", "EXAMPLE GYM", "EXAMPLE SHOP"].map((m) => `${m} ${stamp}`);
  // The suite's clock is Monday 16 November: this week, last week and the week of 2 November.
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, {
    data: [
      { id: "wk1", date: "2026-11-16", pence: -1840, text: market },
      { id: "wk2", date: "2026-11-10", pence: -2999, text: gym },
      { id: "wk3", date: "2026-11-02", pence: -650, text: shop },
    ],
  });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const payments = page.getByRole("region", { name: "Payments" });
  const row = (name: string) => payments.getByRole("button", { name: new RegExp(name) });
  try {
    await expect(row(market)).toBeVisible();
    await expect(row(gym)).toBeVisible();
    await expect(payments.getByText("£18.40 out · £0.00 in · 1 to sort")).toBeVisible();
    await expect(payments.getByText("£29.99 out · £0.00 in · 1 to sort")).toBeVisible();

    // The week of 2 November starts closed, with its totals in view.
    const old = payments.locator("summary", { hasText: "2–8 Nov" });
    await expect(old).toContainText("£6.50 out · £0.00 in · 1 to sort");
    await expect(row(shop)).toBeHidden();
    await old.click();
    await expect(row(shop)).toBeVisible();
    await old.click();
    await expect(row(shop)).toBeHidden();
    await old.focus();
    await page.keyboard.press("Enter");
    await expect(row(shop)).toBeVisible();

    // Sorting one takes it off the count at once, and it stays off after a reload.
    await row(market).click();
    const sheet = page.getByRole("dialog", { name: "What was this for?" });
    await sheet.getByRole("checkbox", { name: "Always for this merchant" }).uncheck();
    await sheet.getByRole("button", { name: "Groceries" }).click();
    await expect(row(market)).toContainText("Groceries");
    await expect(payments.getByText("£18.40 out · £0.00 in", { exact: true })).toBeVisible();
    await page.reload();
    await expect(payments.getByText("£18.40 out · £0.00 in", { exact: true })).toBeVisible();
    await expect(row(shop), "an older week starts closed again").toBeHidden();
  } finally {
    // Back as it was.
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
