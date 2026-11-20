import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// Cook from the amounts you shopped for: a planned cook's recipe opens from the
// Meals page and from the Kitchen at the cook's own portions and size, the same
// numbers its plan row shows, and says so; changing the portions says the amounts
// no longer match the list. It holds at 412 and 360 px.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

/** A week to cook from. An earlier save test may have planned one; alone on a fresh database, none has. */
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

const cookLink = (page: Page) => page.locator('main a[href*="?cook="]');

test("a planned cook's recipe opens at the cook's portions and size, from Meals and from the Kitchen", async ({
  page,
  request,
}) => {
  await aPlannedWeek(page, request);
  await page.goto("/life");
  // A main's plan row: "4 portions · 812 kcal · 48 g · 60 min".
  const row = page
    .getByRole("listitem")
    .filter({ has: cookLink(page) })
    .filter({ hasText: /\d+ portions · \d+ kcal/ })
    .first();
  const [, portions, kcal] = /(\d+) portions · (\d+) kcal/.exec(await row.innerText())!;
  const href = await row.locator('a[href*="?cook="]').getAttribute("href");
  await row.locator('a[href*="?cook="]').click();

  await expect(page).toHaveURL(href!);
  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients.getByText(`${portions} portions`, { exact: true })).toBeVisible();
  await expect(
    ingredients.getByText(new RegExp(`^The cook .+: ${portions} portions, sized to your target`)),
  ).toBeVisible();
  await expect(page.getByText(new RegExp(`^${kcal} kcal · \\d+ g protein a portion$`))).toBeVisible();

  // One more portion than planned keeps the cook, and says the list no longer matches.
  await ingredients.getByRole("link", { name: "More portions" }).click();
  await expect(ingredients.getByText(`${Number(portions) + 1} portions`, { exact: true })).toBeVisible();
  await expect(ingredients.getByText(`Changed from the ${portions} portions planned`, { exact: false })).toBeVisible();
  await ingredients.getByRole("link", { name: "Fewer portions" }).click();
  await expect(ingredients.getByText(/^The cook /)).toBeVisible();

  // The Kitchen's cook rows open the same page.
  await page.goto("/life/kitchen?tab=fridge");
  await page.locator(`main a[href="${href}"]`).first().click();
  await expect(page).toHaveURL(href!);
  await expect(ingredients.getByText(`${portions} portions`, { exact: true })).toBeVisible();

  // The page holds on a small phone.
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(href!);
    await expect(ingredients.getByText(/^The cook /)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
