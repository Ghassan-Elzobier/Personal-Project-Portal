import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// Pack sizes: a Sainsbury's link pasted into the product form reads its size the
// way the site writes it (2-27l is 2.27 litres), the list buys by that pack, and a
// saved pack that disagrees with its own link is flagged, at once and after a
// reload. The test puts the product back as it found it.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";
const MILK = "https://www.sainsburys.co.uk/gol-ui/product/sainsburys-british-whole-milk-2-27l-4-pints";

/** A week to shop for. An earlier save test may have planned one; alone on a fresh database, none has. */
async function aPlannedWeek(page: Page, request: APIRequestContext) {
  const claude = await connectClaude(page, request);
  try {
    const day = JSON.parse((await claude.call("get_life_day", { date: TODAY })).text) as {
      routine: { kind: string; slot?: string; detail: string }[];
    };
    const breakfast = day.routine.find((r) => r.kind === "meal" && r.slot === "breakfast");
    if (breakfast && breakfast.detail !== "Nothing planned") return;
    const planned = await claude.call("plan_meal_week", {});
    expect(planned.isError, planned.text).toBe(false);
  } finally {
    await claude.disconnect();
  }
}

const sheet = (page: Page) => page.getByRole("dialog", { name: /^Sainsbury's product for / });

test("a pasted link reads 2-27l as 2.27 litres, and a pack that disagrees with its link is flagged", async ({
  page,
  request,
}) => {
  await aPlannedWeek(page, request);
  await page.goto("/life/kitchen?tab=shop");
  // A line counted by weight with no product picked yet.
  const line = page
    .getByRole("listitem")
    .filter({ hasText: /\d (g|kg|ml|l) needed/ })
    .filter({ has: page.getByRole("button", { name: "Pick", exact: true }) })
    .first();
  await line.getByRole("button", { name: "Pick", exact: true }).click();
  await sheet(page).getByLabel("Product link").fill(MILK);
  await expect(sheet(page).getByLabel("Pack", { exact: true })).toHaveValue("2270");
  await expect(sheet(page).getByLabel("Unit", { exact: true })).toHaveValue("ml");
  await sheet(page).getByLabel("Name", { exact: true }).fill("Example pack-size milk");
  await sheet(page).getByRole("button", { name: "Save product" }).click();
  await expect(sheet(page)).toBeHidden();

  const mine = page.getByRole("listitem").filter({ hasText: "Example pack-size milk" });
  await expect(mine).toContainText("2270 ml packs");
  await expect(mine.getByText(/^Check the pack size/)).toHaveCount(0);
  await page.reload();
  await expect(mine).toContainText("2270 ml packs");

  // Typed wrong by hand, the pack is flagged against its own link.
  await mine.getByRole("button", { name: "Product", exact: true }).click();
  await sheet(page).getByLabel("Pack", { exact: true }).fill("27000");
  await sheet(page).getByRole("button", { name: "Save product" }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(mine.getByText("Check the pack size: its link says 2270 ml")).toBeVisible();
  await page.reload();
  await expect(mine.getByText("Check the pack size: its link says 2270 ml")).toBeVisible();

  // Back as it was.
  await mine.getByRole("button", { name: "Product", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Forget it" }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole("listitem").filter({ hasText: "Example pack-size milk" })).toHaveCount(0);
});
