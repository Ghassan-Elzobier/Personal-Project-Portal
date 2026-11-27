import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// Payments the rules can't sort get Claude's suggestion (the made-up one in
// e2e/fake-claude/money.mjs), from the merchants' names alone. One tap sorts a merchant
// as "Always for this merchant" does by hand, so all its payments show the category, at
// once and after a reload. Like the other Money tests it connects the made-up bank and
// erases it again. The merchants are named for the run, since the rule a tap saves
// outlives the bank data.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("Claude suggests where unsorted merchants belong, and one tap sorts every payment of one, after a reload too", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  const run = randomUUID().slice(0, 6).toUpperCase();
  const bakehouse = `EXAMPLE BAKEHOUSE ${run}`;
  const wall = `EXAMPLE CLIMBING WALL ${run}`;
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=184250`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, {
    data: [
      { id: `${run}-1`, date: "2026-11-09", pence: -1250, text: bakehouse },
      { id: `${run}-2`, date: "2026-11-12", pence: -900, text: bakehouse },
      { id: `${run}-3`, date: "2026-11-11", pence: -3500, text: wall },
      { id: `${run}-4`, date: "2026-11-13", pence: -700, text: `EXAMPLE QX ${run}` },
    ],
  });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  try {
    const payments = page.getByRole("region", { name: "Payments" });
    await payments.getByRole("button", { name: "Suggest categories" }).click();
    const list = payments.getByRole("list", { name: "Suggested categories" });
    await expect(list.getByRole("listitem").filter({ hasText: bakehouse })).toContainText("Groceries · 2 payments");
    await expect(list.getByRole("listitem").filter({ hasText: wall })).toContainText("Fun and social");
    // A merchant Claude can't place from its name is left for the owner.
    await expect(list).not.toContainText(`EXAMPLE QX ${run}`);

    await list.getByRole("button", { name: `Sort ${bakehouse} as Groceries` }).click();
    await expect(list.getByRole("listitem").filter({ hasText: bakehouse })).toHaveCount(0);
    const rows = payments.getByRole("button", { name: new RegExp(`^${bakehouse}`) });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Groceries");
    await expect(rows.last()).toContainText("Groceries");
    await page.reload();
    await expect(rows.first()).toContainText("Groceries");
    await expect(rows.last()).toContainText("Groceries");
    await expect(payments.getByRole("button", { name: new RegExp(`^${wall}`) })).toContainText("Not sorted");
  } finally {
    // Back as it was.
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
