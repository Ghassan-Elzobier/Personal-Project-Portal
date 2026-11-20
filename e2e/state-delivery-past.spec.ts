import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { INGREDIENTS } from "../src/lib/life/ingredients.ts";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// A delivery onto food past its date: the fresh pack replaces the old remainder
// rather than topping it up and giving it the new pack's date, at once and after a
// reload, and Undo delivery puts the old remainder back as it was. The remainder is
// set up through the database (only a delivery gives food a date) and cleared after.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** A batch week waiting for its delivery, planned as one if the week isn't. */
async function aWeekToDeliver(page: Page, request: APIRequestContext) {
  await page.goto("/life/kitchen?tab=shop");
  if (await page.getByRole("button", { name: "Delivery arrived" }).count()) return;
  const claude = await connectClaude(page, request);
  try {
    const planned = await claude.call("plan_meal_week", { mode: "batch" });
    expect(planned.isError, planned.text).toBe(false);
  } finally {
    await claude.disconnect();
  }
  await page.goto("/life/kitchen?tab=shop");
  await expect(page.getByRole("button", { name: "Delivery arrived" })).toBeVisible();
}

test("a delivery replaces food past its date, and Undo delivery puts it back", async ({ page, request }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await aWeekToDeliver(page, request);

  // One pack of something weighed: "Carrots × 1" with "1 kg packs".
  const line = page
    .getByRole("listitem")
    .filter({ hasText: /\d (g|kg) needed · \d+(\.\d+)? (g|kg) packs/ })
    .filter({ has: page.getByText(/ × 1$/) })
    .first();
  const name = (await line.getByText(/ × 1$/).innerText()).replace(/ × 1$/, "");
  const pack = /· (\d+(?:\.\d+)? (?:g|kg)) packs/.exec(await line.innerText())![1];
  const item = [...INGREDIENTS.values()].find((i) => i.name === name)!;
  expect(item, `'${name}' is an ingredient`).toBeTruthy();

  const db = await ownerDatabase();
  const set = (qty: number, goodUntil: string) =>
    db.call("life_stock", { p_changes: [{ item: item.key, qty, good_until: goodUntil }], p_mode: "set" });
  await set(300, "2026-11-10");
  try {
    const row = page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

    await page.goto("/life/kitchen?tab=shop");
    await page.getByRole("button", { name: "Delivery arrived" }).click();
    await page.getByRole("button", { name: /^Put \d+ items? away$/ }).click();
    await expect(page.getByRole("button", { name: "Undo delivery" })).toBeVisible();

    // The 300 g past its date is replaced by the pack, not added to it.
    await page.goto("/life/kitchen?tab=cupboard");
    await expect(row).toContainText(`${pack} · good until`);
    await expect(row).not.toContainText("past its date");
    await page.reload();
    await expect(row).toContainText(`${pack} · good until`);

    // Undo delivery: the old remainder is back, with its own date.
    await page.goto("/life/kitchen?tab=shop");
    await page.getByRole("button", { name: "Undo delivery" }).click();
    await expect(page.getByRole("button", { name: "Delivery arrived" })).toBeVisible();
    await page.goto("/life/kitchen?tab=cupboard");
    await expect(row).toContainText("300 g · past its date: no longer counted");
  } finally {
    await set(0, "");
  }
});
