import { expect, test } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// Subscriptions on the Money page: a bill Money found is marked as a subscription,
// asks keep or cancel, and once kept stops asking, after a reload too. The card
// holds at 360 px. Like the other Money tests it connects the made-up bank, and
// erases it again so the Money screenshot stays as approved.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("a bill marked as a subscription asks keep or cancel, and once kept stops asking after a reload", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  const feed = (list: object[]) => request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: list });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  // Three monthly payments to a made-up streaming service: Money finds the bill by itself.
  await feed([
    { id: "s1", date: "2026-09-10", pence: -1299, text: "EXAMPLE STREAMING" },
    { id: "s2", date: "2026-10-10", pence: -1299, text: "EXAMPLE STREAMING" },
    { id: "s3", date: "2026-11-10", pence: -1299, text: "EXAMPLE STREAMING" },
  ]);
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const subs = page.getByRole("region", { name: "Subscriptions" });
  const keep = subs.getByRole("button", { name: "Keep EXAMPLE STREAMING" });
  try {
    await expect(subs.getByText(/^None sorted yet/)).toBeVisible();
    await subs.getByText("Add a bill (1)").click();
    await subs.getByRole("button", { name: "Mark EXAMPLE STREAMING as a subscription" }).click();
    await expect(subs.getByText("£12.99 a month · renews 10 Dec", { exact: true })).toBeVisible();
    await expect(subs.getByText("£12.99 a month", { exact: true })).toBeVisible();
    await expect(keep).toBeVisible();

    // The card holds at 360 px with no sideways scroll.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(keep).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      "no sideways scroll at 360 px",
    ).toBe(true);

    await keep.click();
    await expect(keep).toHaveCount(0);
    await expect(subs.getByText("£12.99 a month · renews 10 Dec", { exact: true })).toBeVisible();
    await page.reload();
    await expect(subs.getByText("£12.99 a month · renews 10 Dec", { exact: true })).toBeVisible();
    await expect(keep).toHaveCount(0);
  } finally {
    // Back as it was.
    await feed([]);
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
